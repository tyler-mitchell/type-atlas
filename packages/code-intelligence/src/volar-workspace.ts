import { fork } from "node:child_process";
import { stat } from "node:fs/promises";
import { watch } from "chokidar";
import * as path from "pathe";
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
import { isFileInDir } from "@volar/language-server/node.js";
import { ReadFileRequest } from "@featuretype/code-intelligence-language-server/protocol";
import { URI } from "vscode-uri";
import {
  clientCapabilities,
  getClientConfiguration,
} from "./language-client.ts";

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
  path.matchesGlob(relativePath, watcher.globPattern);

const startVolarWorkspace = async (
  workspaceRoot: string,
  languageServerEntry: URL,
) => {
  const workspaceStat = await stat(workspaceRoot).catch(() => undefined);
  if (!workspaceStat?.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
  }

  const languageServer = fork(
    languageServerEntry,
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

  let watcherError: Error | undefined;
  const watcher = watch(workspaceRoot, {
    ignoreInitial: true,
    followSymlinks: false,
  });
  languageServer.once("close", () => void watcher.close());
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

    watcher.on("all", (event, filePath) => {
      const relativePath = path.relative(workspaceRoot, filePath);
      const types: readonly FileChangeType[] = event === "change"
        ? [FileChangeType.Changed]
        : event === "add" || event === "addDir"
        ? [FileChangeType.Created]
        : [FileChangeType.Deleted];
      void sendFileChanges(relativePath, types).then(() =>
        path.matchesGlob(relativePath, "**/node_modules/{*,@*/*}")
          ? sendFileChanges(path.join(relativePath, "package.json"), types)
          : undefined
      ).catch((error) => {
        watcherError = error instanceof Error ? error : new Error(String(error));
      });
    });
    watcher.on("error", (error) => {
      watcherError = error;
    });
  } catch (error) {
    await watcher.close();
    connection.dispose();
    terminateLanguageServer();
    await languageServerExit;
    throw languageServerError ?? error;
  }

  let disposed = false;
  const getWorkspaceUri = (file: string) => {
    const filePath = path.resolve(workspaceRoot, file);
    if (!isFileInDir(filePath, workspaceRoot)) {
      throw new Error(`File is outside the workspace: ${file}`);
    }
    return URI.file(filePath).toString();
  };
  const readTextDocumentUri = async (uri: string) => {
    if (watcherError) throw watcherError;
    const source = await connection.sendRequest(ReadFileRequest.type, { uri });
    if (source === null) {
      throw new Error(`Source document is unavailable: ${uri}`);
    }
    return { textDocument: { uri }, source };
  };
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
          request.method,
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
      return (await readTextDocumentUri(getWorkspaceUri(file))).textDocument;
    },
    readTextDocument(file: string) {
      return readTextDocumentUri(getWorkspaceUri(file));
    },
    readTextDocumentUri,
    getWorkspaceUri,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await watcher.close();
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

/** Owns one long-lived Volar workspace per workspace root. */
export const createVolarWorkspaces = (languageServer: URL) => {
  const entries = new Map<string, Promise<VolarWorkspace>>();

  const get = (root: string): Promise<VolarWorkspace> => {
    const workspaceRoot = path.resolve(root);
    const existing = entries.get(workspaceRoot);
    if (existing) return existing;

    const workspace = startVolarWorkspace(workspaceRoot, languageServer);
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
