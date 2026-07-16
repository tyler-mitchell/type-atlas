import { fork } from "node:child_process";
import { stat, watch } from "node:fs/promises";
import path from "node:path";
import {
  CancellationTokenSource,
  ConfigurationRequest,
  createProtocolConnection,
  type DidChangeWatchedFilesRegistrationOptions,
  DidChangeWatchedFilesNotification,
  ExitNotification,
  type FileSystemWatcher,
  FileChangeType,
  InitializedNotification,
  InitializeRequest,
  InlayHintRefreshRequest,
  IPCMessageReader,
  IPCMessageWriter,
  RegistrationRequest,
  SemanticTokensRefreshRequest,
  type RequestType,
  ShutdownRequest,
  UnregistrationRequest,
  WatchKind,
} from "vscode-languageserver-protocol/node.js";
import { URI } from "vscode-uri";
import {
  clientCapabilities,
  getClientConfiguration,
} from "./language-client.ts";

const isContainedPath = (relativePath: string) =>
  relativePath !== ".." &&
  !relativePath.startsWith(`..${path.sep}`) &&
  !path.isAbsolute(relativePath);

const watchKind = (type: FileChangeType): WatchKind =>
  type === FileChangeType.Created
    ? WatchKind.Create
    : type === FileChangeType.Changed
    ? WatchKind.Change
    : WatchKind.Delete;

const matchesWatcher = (
  watcher: FileSystemWatcher,
  relativePath: string,
  type: FileChangeType,
) =>
  typeof watcher.globPattern === "string" &&
  ((watcher.kind ??
    (WatchKind.Create | WatchKind.Change | WatchKind.Delete)) &
      watchKind(type)) !== 0 &&
  path.posix.matchesGlob(
    relativePath.split(path.sep).join(path.posix.sep),
    watcher.globPattern,
  );

const startVolarWorkspace = async (workspaceRoot: string) => {
  const workspaceStat = await stat(workspaceRoot).catch(() => undefined);
  if (!workspaceStat?.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
  }

  const languageServer = fork(
    new URL(
      import.meta.resolve("@featuretype/code-intelligence-language-server/node"),
    ),
    ["--node-ipc"],
    {
      cwd: workspaceRoot,
      execArgv: [],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    },
  );
  const languageServerExit = new Promise<void>((resolve) =>
    languageServer.once("close", () => resolve())
  );
  let languageServerError: Error | undefined;
  languageServer.on("error", (error) => {
    languageServerError = error;
  });
  const isLanguageServerRunning = () =>
    languageServer.exitCode === null && languageServer.signalCode === null;
  const terminateLanguageServer = () => {
    if (isLanguageServerRunning()) languageServer.kill("SIGKILL");
  };

  const connection = createProtocolConnection(
    new IPCMessageReader(languageServer),
    new IPCMessageWriter(languageServer),
  );
  languageServer.once("close", () => connection.dispose());
  connection.listen();
  connection.onRequest(
    ConfigurationRequest.type,
    ({ items }) => items.map(({ section }) => getClientConfiguration(section)),
  );
  connection.onRequest(InlayHintRefreshRequest.type, () => undefined);
  connection.onRequest(SemanticTokensRefreshRequest.type, () => undefined);

  const registrations = new Map<
    string,
    DidChangeWatchedFilesRegistrationOptions
  >();
  let resolveRegistration: () => void = () => undefined;
  const registered = new Promise<void>((resolve) => {
    resolveRegistration = resolve;
  });
  connection.onRequest(RegistrationRequest.type, ({ registrations: items }) => {
    for (const registration of items) {
      if (registration.method !== DidChangeWatchedFilesNotification.method) {
        continue;
      }
      registrations.set(
        registration.id,
        registration.registerOptions as DidChangeWatchedFilesRegistrationOptions,
      );
      resolveRegistration();
    }
  });
  connection.onRequest(
    UnregistrationRequest.type,
    ({ unregisterations }) => {
      for (const registration of unregisterations) {
        if (registration.method === DidChangeWatchedFilesNotification.method) {
          registrations.delete(registration.id);
        }
      }
    },
  );

  const watcherController = new AbortController();
  languageServer.once("close", () => watcherController.abort());
  let watcherTask = Promise.resolve();
  let watcherError: Error | undefined;
  try {
    const workspaceUri = URI.file(workspaceRoot).toString();
    await connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: workspaceUri,
      workspaceFolders: [{
        uri: workspaceUri,
        name: path.basename(workspaceRoot),
      }],
      capabilities: clientCapabilities,
    });
    await connection.sendNotification(InitializedNotification.type, {});
    await Promise.race([
      registered,
      languageServerExit.then(() => {
        throw languageServerError ??
          new Error("The language server exited during initialization.");
      }),
    ]);

    const sendFileChanges = async (
      relativePath: string,
      types: readonly FileChangeType[],
    ) => {
      const changes = types
        .filter((type) =>
          [...registrations.values()].some(({ watchers }) =>
            watchers.some((watcher) =>
              matchesWatcher(watcher, relativePath, type)
            )
          )
        )
        .map((type) => ({
          uri: URI.file(path.resolve(workspaceRoot, relativePath)).toString(),
          type,
        }));
      if (changes.length) {
        await connection.sendNotification(
          DidChangeWatchedFilesNotification.type,
          { changes },
        );
      }
    };

    watcherTask = (async () => {
      try {
        for await (
          const { eventType, filename } of watch(workspaceRoot, {
            recursive: true,
            signal: watcherController.signal,
          })
        ) {
          if (!filename) continue;
          const relativePath = filename.toString();
          const filePath = path.resolve(workspaceRoot, relativePath);
          const types: readonly FileChangeType[] = eventType === "change"
            ? [FileChangeType.Changed]
            : await stat(filePath).then(
              () => [FileChangeType.Created, FileChangeType.Changed],
              () => [FileChangeType.Deleted],
            );
          await sendFileChanges(relativePath, types);
          if (path.matchesGlob(relativePath, "**/node_modules/{*,@*/*}"))
            await sendFileChanges(path.join(relativePath, "package.json"), types);
        }
      } catch (error) {
        if (!watcherController.signal.aborted) {
          watcherError = error instanceof Error
            ? error
            : new Error(String(error));
        }
      }
    })();
  } catch (error) {
    watcherController.abort();
    await watcherTask;
    connection.dispose();
    terminateLanguageServer();
    await languageServerExit;
    throw languageServerError ?? error;
  }

  let disposed = false;
  return {
    closed: languageServerExit,
    async sendRequest<Params, Result, Error>(
      request: RequestType<Params, Result, Error>,
      params: Params,
      signal: AbortSignal,
    ): Promise<Result> {
      if (watcherError) throw watcherError;
      const cancellation = new CancellationTokenSource();
      const cancel = () => cancellation.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();

      try {
        return await connection.sendRequest(
          request,
          params,
          cancellation.token,
        );
      } catch (error) {
        if (signal.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new Error("Code intelligence request was cancelled.");
        }
        throw error;
      } finally {
        signal.removeEventListener("abort", cancel);
        cancellation.dispose();
      }
    },
    async getTextDocument(file: string) {
      const filePath = path.resolve(workspaceRoot, file);
      const relativePath = path.relative(workspaceRoot, filePath);
      if (!isContainedPath(relativePath)) {
        throw new Error(`File is outside the workspace: ${file}`);
      }
      const fileStat = await stat(filePath).catch(() => undefined);
      if (!fileStat?.isFile()) {
        throw new Error(`File is not a regular file: ${file}`);
      }
      return { uri: URI.file(filePath).toString() };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      watcherController.abort();
      await watcherTask;
      const shutdownTimer = setTimeout(terminateLanguageServer, 2_000);
      shutdownTimer.unref();
      try {
        if (isLanguageServerRunning()) {
          await connection.sendRequest(ShutdownRequest.type);
          await connection.sendNotification(ExitNotification.type);
          await languageServerExit;
        }
      } finally {
        clearTimeout(shutdownTimer);
        connection.dispose();
        terminateLanguageServer();
        await languageServerExit;
      }
    },
  };
};

export type VolarWorkspace = Awaited<ReturnType<typeof startVolarWorkspace>>;

export type VolarWorkspacePool = ReturnType<typeof createVolarWorkspaces>;

/** Owns one long-lived Volar workspace per MCP workspace root. */
export const createVolarWorkspaces = () => {
  const entries = new Map<string, Promise<VolarWorkspace>>();

  const get = (root: string): Promise<VolarWorkspace> => {
    if (!path.isAbsolute(root)) {
      return Promise.reject(
        new Error(`Workspace must be an absolute path: ${root}`),
      );
    }
    const workspaceRoot = path.resolve(root);
    const existing = entries.get(workspaceRoot);
    if (existing) return existing;

    const workspace = startVolarWorkspace(workspaceRoot);
    entries.set(workspaceRoot, workspace);
    const remove = () => {
      if (entries.get(workspaceRoot) === workspace) {
        entries.delete(workspaceRoot);
      }
    };
    void workspace.then(
      ({ closed }) => closed.then(remove),
      remove,
    );
    return workspace;
  };

  return {
    get,
    async dispose() {
      const current = [...entries.values()];
      entries.clear();
      await Promise.all(current.map((workspace) =>
        workspace.then(
          (active) => active.dispose(),
          () => undefined,
        )
      ));
    },
  };
};
