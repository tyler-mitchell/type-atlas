import { fork } from "node:child_process";
import { stat } from "node:fs/promises";
import { watch } from "chokidar";
import * as path from "pathe";
import {
  CancellationTokenSource,
  ConfigurationRequest,
  createProtocolConnection,
  DidCloseTextDocumentNotification,
  type DidChangeWatchedFilesRegistrationOptions,
  DidChangeWatchedFilesNotification,
  DidOpenTextDocumentNotification,
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
import { ReadFileRequest } from "@type-atlas/language-server/protocol";
import { URI } from "vscode-uri";
import { clientCapabilities, getClientConfiguration } from "./language-client.ts";
import { containingGitSubmodule, findGitSubmoduleRoots } from "./git-submodules.ts";

const watchKind = (type: FileChangeType): WatchKind =>
  type === FileChangeType.Created
    ? WatchKind.Create
    : type === FileChangeType.Changed
      ? WatchKind.Change
      : WatchKind.Delete;

const matchesWatcher = (watcher: FileSystemWatcher, relativePath: string, type: FileChangeType) =>
  typeof watcher.globPattern === "string" &&
  ((watcher.kind ?? WatchKind.Create | WatchKind.Change | WatchKind.Delete) & watchKind(type)) !==
    0 &&
  path.matchesGlob(relativePath, watcher.globPattern);

/**
 * How long an unused workspace keeps its language server.
 *
 * Reloading a disposed workspace rebuilds its TypeScript program, which costs
 * seconds on a monorepo, so this has to outlast the gaps between an agent's
 * calls. Agents pause far longer than a person typing: they reason between
 * tool calls and interleave reads, edits, and shell commands.
 */
const idleWorkspaceTimeout = 30 * 60_000;

const startVolarWorkspace = async (
  workspaceRoot: string,
  languageServerEntry: URL,
  release: () => void,
) => {
  const workspaceStat = await stat(workspaceRoot).catch(() => undefined);
  if (!workspaceStat?.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
  }
  const submoduleRoots = await findGitSubmoduleRoots(workspaceRoot);

  const languageServer = fork(languageServerEntry, ["--node-ipc"], {
    cwd: workspaceRoot,
    execArgv: [],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const languageServerExit = new Promise<void>((resolve) =>
    languageServer.once("close", () => resolve()),
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
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  languageServer.once("close", () => {
    clearTimeout(idleTimer);
    connection.dispose();
  });
  connection.listen();
  connection.onRequest(ConfigurationRequest.type, ({ items }) =>
    items.map(({ section }) => getClientConfiguration(section)),
  );
  connection.onRequest(InlayHintRefreshRequest.type, () => undefined);
  connection.onRequest(SemanticTokensRefreshRequest.type, () => undefined);

  const registrations = new Map<string, DidChangeWatchedFilesRegistrationOptions>();
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
  connection.onRequest(UnregistrationRequest.type, ({ unregisterations }) => {
    for (const registration of unregisterations) {
      if (registration.method === DidChangeWatchedFilesNotification.method) {
        registrations.delete(registration.id);
      }
    }
  });

  let watcherError: Error | undefined;
  const watcher = watch(workspaceRoot, {
    ignored: (file) =>
      containingGitSubmodule(path.resolve(workspaceRoot, file), submoduleRoots) !== undefined,
    ignoreInitial: true,
    followSymlinks: false,
  });
  languageServer.once("close", () => void watcher.close());
  try {
    const workspaceUri = URI.file(workspaceRoot).toString();
    await connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: workspaceUri,
      workspaceFolders: [
        {
          uri: workspaceUri,
          name: path.basename(workspaceRoot),
        },
      ],
      capabilities: clientCapabilities,
    });
    await connection.sendNotification(InitializedNotification.type, {});
    await Promise.race([
      registered,
      languageServerExit.then(() => {
        throw languageServerError ?? new Error("The language server exited during initialization.");
      }),
    ]);

    const sendFileChanges = async (relativePath: string, types: readonly FileChangeType[]) => {
      const changes = types
        .filter((type) =>
          [...registrations.values()].some(({ watchers }) =>
            watchers.some((watcher) => matchesWatcher(watcher, relativePath, type)),
          ),
        )
        .map((type) => ({
          uri: URI.file(path.resolve(workspaceRoot, relativePath)).toString(),
          type,
        }));
      if (changes.length) {
        await connection.sendNotification(DidChangeWatchedFilesNotification.type, { changes });
      }
    };

    watcher.on("all", (event, filePath) => {
      const relativePath = path.relative(workspaceRoot, filePath);
      const types: readonly FileChangeType[] =
        event === "change"
          ? [FileChangeType.Changed]
          : event === "add" || event === "addDir"
            ? [FileChangeType.Created]
            : [FileChangeType.Deleted];
      void sendFileChanges(relativePath, types)
        .then(() =>
          path.matchesGlob(relativePath, "**/node_modules/{*,@*/*}")
            ? sendFileChanges(path.join(relativePath, "package.json"), types)
            : undefined,
        )
        .catch((error) => {
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
    const submoduleRoot = containingGitSubmodule(filePath, submoduleRoots);
    if (submoduleRoot) {
      throw new Error(
        `File belongs to nested workspace ${path.relative(workspaceRoot, submoduleRoot)}. Use that path as workspace.`,
      );
    }
    return URI.file(filePath).toString();
  };
  const sendRequest = async <Params, Result, Error>(
    request: RequestType<Params, Result, Error>,
    params: Params,
    signal?: AbortSignal,
  ): Promise<Result> => {
    if (watcherError) throw watcherError;
    clearTimeout(idleTimer);
    const cancellation = signal ? new CancellationTokenSource() : undefined;
    const cancel = () => cancellation?.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();

    try {
      return await connection.sendRequest(request.method, params, cancellation?.token);
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("TypeAtlas request was cancelled.");
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
      cancellation?.dispose();
      if (!connection.hasPendingResponse() && !disposed && isLanguageServerRunning()) {
        idleTimer = setTimeout(() => {
          release();
          void dispose().catch(() => undefined);
        }, idleWorkspaceTimeout);
        idleTimer.unref();
      }
    }
  };
  const readTextDocumentUri = async (uri: string, signal?: AbortSignal) => {
    const source = await sendRequest(ReadFileRequest.type, { uri }, signal);
    if (source === null) {
      throw new Error(`Source document is unavailable: ${uri}`);
    }
    return { textDocument: { uri }, source };
  };
  return {
    closed: languageServerExit,
    sendRequest,
    async getTextDocument(file: string) {
      return (await readTextDocumentUri(getWorkspaceUri(file))).textDocument;
    },
    readTextDocument(file: string, signal?: AbortSignal) {
      return readTextDocumentUri(getWorkspaceUri(file), signal);
    },
    readTextDocumentUri,
    getWorkspaceUri,
    async withTextDocument<T>({
      uri,
      languageId,
      source,
      signal,
      task,
    }: {
      readonly uri: string;
      readonly languageId: string;
      readonly source: string;
      readonly signal?: AbortSignal;
      readonly task: (textDocument: { readonly uri: string }) => Promise<T>;
    }) {
      signal?.throwIfAborted();
      await connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId, version: 1, text: source },
      });
      try {
        return await task({ uri });
      } finally {
        await connection.sendNotification(DidCloseTextDocumentNotification.type, {
          textDocument: { uri },
        });
      }
    },
    dispose,
  };

  async function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(idleTimer);
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
  }
};

/**
 * An active language-server process scoped to one normalized workspace root.
 *
 * Requests observe watched filesystem changes, may be cancelled, and keep the
 * process alive while work is pending. Call `dispose` when the owning process
 * shuts down; otherwise an idle workspace releases itself automatically.
 */
export type VolarWorkspace = Awaited<ReturnType<typeof startVolarWorkspace>>;

/** Owns and reuses active workspaces until they become idle or the pool is disposed. */
export type VolarWorkspacePool = ReturnType<typeof createVolarWorkspaces>;

/**
 * Creates a pool that owns at most one active language-server process per
 * normalized workspace root.
 *
 * Concurrent calls to `get` for the same root share initialization. Failed,
 * exited, and idle processes are removed so a later request starts a fresh
 * workspace. Disposing the pool closes every active process.
 */
export const createVolarWorkspaces = (languageServer: URL) => {
  const entries = new Map<string, Promise<VolarWorkspace>>();

  const get = (root: string): Promise<VolarWorkspace> => {
    const workspaceRoot = path.resolve(root);
    const existing = entries.get(workspaceRoot);
    if (existing) return existing;

    const workspace = startVolarWorkspace(workspaceRoot, languageServer, remove);
    entries.set(workspaceRoot, workspace);
    void workspace.then(({ closed }) => closed.then(remove), remove);
    return workspace;

    function remove() {
      if (entries.get(workspaceRoot) === workspace) {
        entries.delete(workspaceRoot);
      }
    }
  };

  return {
    get,
    async dispose() {
      const current = [...entries.values()];
      entries.clear();
      await Promise.all(
        current.map((workspace) =>
          workspace.then(
            (active) => active.dispose(),
            () => undefined,
          ),
        ),
      );
    },
  };
};
