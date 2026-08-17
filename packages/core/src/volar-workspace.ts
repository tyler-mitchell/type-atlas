import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { totalmem } from "node:os";
import { readFile, stat } from "node:fs/promises";
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
import { GetMatchTsConfigRequest } from "@volar/language-server/protocol.js";
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
 * Heap ceiling for a workspace's language server.
 *
 * A forked child inherits none of the parent's exec arguments and takes Node's
 * default, which is derived from total memory and lands near 4 GB on a 16 GB
 * machine. One TypeScript program per package is real working set rather than
 * waste, and a monorepo with several large packages loaded at once reached that
 * default and aborted, leaving most of the machine unused.
 *
 * Half of total memory keeps the ceiling proportional on smaller machines,
 * where the default is already low and raising it blindly would only trade a
 * crash for swapping. This defers exhaustion rather than removing it: nothing
 * bounds how many projects a session loads, and Volar's `project.reload()` is
 * the affordance for reclaiming them if that becomes the failure again.
 */
const languageServerHeapMegabytes = () =>
  Math.max(2048, Math.min(8192, Math.floor(totalmem() / 1024 / 1024 / 2)));

/** Files a TypeScript project can report diagnostics for. */
const sourceFile = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

/**
 * How long one request may hold the language server before it is ended.
 *
 * Longer than the slowest legitimate answer measured here — a cold whole-project
 * check of a three-thousand-file program — so a slow project is not mistaken for
 * a stuck one.
 */
const requestDeadline = 60_000;

const startVolarWorkspace = async (workspaceRoot: string, languageServerEntry: URL) => {
  const workspaceStat = await stat(workspaceRoot).catch(() => undefined);
  if (!workspaceStat?.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
  }
  const submoduleRoots = await findGitSubmoduleRoots(workspaceRoot);

  let watcherError: Error | undefined;
  /**
   * Notified for every workspace change, so callers need no watcher of their own.
   */
  const changeObservers = new Set<(relativePath: string) => void>();

  /**
   * Source files written since this workspace opened.
   *
   * Checking a whole project is build-scale work — `tsc` needs twenty-five
   * seconds on a large one — and almost none of it concerns what an agent just
   * did. The files it wrote are the ones whose diagnostics it cannot predict,
   * and the watcher this workspace already runs for the language server names
   * them as they change.
   */
  const changedFiles = new Set<string>();

  const watcher = watch(workspaceRoot, {
    // Establishing watches walks the tree, and that walk is what the first call
    // to a workspace waits for. Git's object store is never source, and an
    // installed package changes when something else installs it — a restart-
    // level event, not one TypeScript needs told about, since it resolves
    // modules when it needs them. Descending into either costs the whole walk
    // to learn nothing.
    ignored: (file) => {
      const relativePath = path.relative(workspaceRoot, file);
      const first = relativePath.split(path.sep)[0];
      if (first === ".git" || relativePath.includes("node_modules")) return true;
      return containingGitSubmodule(path.resolve(workspaceRoot, file), submoduleRoots) !== undefined;
    },
    ignoreInitial: true,
    followSymlinks: false,
  });

  const languageServer = fork(languageServerEntry, ["--node-ipc"], {
    cwd: workspaceRoot,
    execArgv: [`--max-old-space-size=${languageServerHeapMegabytes()}`],
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
  const languageServerExitReason = () =>
    languageServerError?.message ??
    (languageServer.signalCode
      ? `killed by ${languageServer.signalCode}, which a memory limit reports as SIGABRT`
      : `exit code ${languageServer.exitCode}`);

  const connection = createProtocolConnection(
    new IPCMessageReader(languageServer),
    new IPCMessageWriter(languageServer),
  );
  languageServer.once("close", () => connection.dispose());
  connection.listen();
  connection.onRequest(ConfigurationRequest.type, ({ items }) =>
    items.map(({ section }) => getClientConfiguration(section)),
  );
  connection.onRequest(InlayHintRefreshRequest.type, () => undefined);
  connection.onRequest(SemanticTokensRefreshRequest.type, () => undefined);

  const registrations = new Map<string, DidChangeWatchedFilesRegistrationOptions>();
  const { promise: registered, resolve: resolveRegistration } = Promise.withResolvers<void>();
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

  languageServer.once("close", () => void watcher.close());

  /**
   * Completes the LSP handshake, once, on the first request that needs it.
   *
   * Reading a file, sizing it, and resolving its uri are filesystem work that
   * this process can do alone, and they are the most common thing asked of a
   * workspace. Initializing first made them wait a second for a TypeScript
   * server they never spoke to.
   */
  const initialized = (async () => {
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
      // Observers see every workspace change, not only the ones a registered
      // language-server watcher matched: a file this server ignores can still
      // be the reason another file's diagnostics changed.
      for (const observe of changeObservers) observe(relativePath);
      if (event === "unlink" || event === "unlinkDir") changedFiles.delete(relativePath);
      else if (sourceFile.test(relativePath)) changedFiles.add(relativePath);
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
  })()
    .catch(async (error) => {
      await watcher.close();
      connection.dispose();
      terminateLanguageServer();
      await languageServerExit;
      throw languageServerError ?? error;
    });
  // Nothing awaits this until a language-server request does, so an unhandled
  // rejection here would crash the process before that.
  void initialized.catch(() => undefined);

  let disposed = false;
  /** Tail of the in-flight `withTextDocument` chain for each open uri. */
  const openDocuments = new Map<string, Promise<void>>();
  /**
   * Increments on every open, so a reused document reads as an edit.
   *
   * One counter rather than one per uri: the protocol requires a document's
   * versions to increase, not to start at one, and a map keyed by uri would
   * hold an entry for every file the session ever touched.
   */
  let documentVersion = 0;
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
  /**
   * Starts the project owning a file, without waiting for it.
   *
   * A session opens by reading, and reading deliberately never reaches the
   * language server — so the program for the project is not begun until the
   * first question that needs types, and that question wears the whole build:
   * seven seconds on a three-thousand-file project. Asking which project owns
   * the file is the cheapest request that makes Volar resolve and build it, so
   * it is asked when a file is first read and its answer thrown away. The build
   * then runs while the agent reads, and the semantic question that follows
   * meets a program that is ready or nearly so.
   */
  const warmProject = (uri: string) => {
    void sendRequest(GetMatchTsConfigRequest.type, { uri }).catch(() => undefined);
  };
  /**
   * Ends the language server when a request has plainly stopped answering.
   *
   * A semantic request cannot be cancelled — see
   * `docs/volar-affordance-evidence.md` § "Semantic requests cannot be
   * cancelled": the token Volar hands TypeScript raises nothing, and a request
   * abandoned at five seconds ran to completion at nearly ten. While it runs the
   * server holds its only thread and stops reading its socket, so every later
   * call for this workspace waits behind it — a folded five-line read needing no
   * type checking has timed out at thirty seconds that way. Ending the process
   * is the only bound a client has.
   *
   * The cost is one project rebuild on the next call, against a queue bounded
   * only by however long the abandoned work runs. This fires on the deadline
   * rather than on a caller giving up, because a caller giving up says nothing
   * about whether the server is stuck.
   */
  const wedged = (method: string) => {
    const deadline: { timer?: ReturnType<typeof setTimeout> } = {};
    const reached = new Promise<never>((_, reject) => {
      deadline.timer = setTimeout(() => {
        terminateLanguageServer();
        reject(
          new Error(
            `The language server for ${workspaceRoot} stopped answering (${method} ran past ${requestDeadline / 1000} seconds) and was ended, because nothing can interrupt a check already under way and every later call would have waited behind it. The next call starts a new one and pays the project load again.`,
          ),
        );
      }, requestDeadline);
    });
    // The race abandons the loser but does not stop it. Left running, every
    // answered request would have armed a timer that killed the server a minute
    // later — observed as a SIGKILL mid-request after a run of successful ones.
    return { reached, clear: () => clearTimeout(deadline.timer) };
  };

  const sendRequest = async <Params, Result, Error>(
    request: RequestType<Params, Result, Error>,
    params: Params,
    signal?: AbortSignal,
  ): Promise<Result> => {
    await initialized;
    if (watcherError) throw watcherError;
    const cancellation = signal ? new CancellationTokenSource() : undefined;
    const cancel = () => cancellation?.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();

    const deadline = wedged(request.method);
    try {
      return await Promise.race([
        connection.sendRequest<Result>(request.method, params, cancellation?.token),
        deadline.reached,
      ]);
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("TypeAtlas request was cancelled.");
      }
      // A language server that exits mid-request disposes the connection, and
      // the rejection every pending request then sees describes the transport
      // rather than what happened. Name the exit instead, so a caller can tell
      // a crash from a normal failure and knows whether retrying can help.
      if (!isLanguageServerRunning()) {
        throw new Error(
          `The language server for ${workspaceRoot} exited during this request (${languageServerExitReason()}). It starts again on the next call. If the same request keeps ending this way, it is too large to answer at once — narrow it and retry.`,
          { cause: languageServerError ?? error },
        );
      }
      throw error;
    } finally {
      deadline.clear();
      signal?.removeEventListener("abort", cancel);
      cancellation?.dispose();
    }
  };
  /**
   * Reads a file's text from disk, without involving the language server.
   *
   * The language server is one process running one thread, and a semantic
   * request holds that thread until TypeScript is finished, so anything asked
   * of it while a check runs waits for the check. Reading a file needs none of
   * that: measured against a busy workspace, the same read took 7.5 seconds
   * through the server and is immediate from disk.
   *
   * Volar's own file system would only matter for language plugins that
   * generate virtual code; this server registers none, so a `file:` read there
   * resolves to exactly this.
   */
  const readTextDocumentUri = async (uri: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const source = await readFile(fileURLToPath(uri), "utf8").catch(() => undefined);
    if (source === undefined) {
      throw new Error(`Source document is unavailable: ${uri}`);
    }
    return { textDocument: { uri }, source };
  };
  return {
    closed: languageServerExit,
    sendRequest,
    async getTextDocument(file: string) {
      const uri = getWorkspaceUri(file);
      // A positional request needs the identifier and the assurance that the
      // file is there. Reading the file to learn that costs its whole size on
      // every hover, definition, and reference; the language server reads it
      // itself either way.
      const present = await stat(fileURLToPath(uri)).then(
        (entry) => entry.isFile(),
        () => false,
      );
      if (!present) throw new Error(`Source document is unavailable: ${uri}`);
      return { uri };
    },
    readTextDocumentUri,
    getWorkspaceUri,
    warmProject,
    /**
     * Opens a document for the duration of one task, then closes it.
     *
     * Callers sharing a uri are serialized. A synthetic document is reused
     * across calls so the language server sees one file being edited rather
     * than a new source file each time, and overlapping opens of that uri
     * would otherwise race: one task's close would land while another is still
     * reading it.
     */
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
    }): Promise<T> {
      await initialized;
      const preceding = openDocuments.get(uri) ?? Promise.resolve();
      const attempt = preceding.then(async () => {
        signal?.throwIfAborted();
        await connection.sendNotification(DidOpenTextDocumentNotification.type, {
          textDocument: { uri, languageId, version: ++documentVersion, text: source },
        });
        try {
          return await task({ uri });
        } finally {
          await connection.sendNotification(DidCloseTextDocumentNotification.type, {
            textDocument: { uri },
          });
        }
      });
      openDocuments.set(
        uri,
        attempt.then(
          () => undefined,
          () => undefined,
        ),
      );
      return attempt;
    },

    /**
     * Observes every file change in this workspace, until the returned function
     * is called.
     *
     * This workspace already watches its root to keep the language server's
     * file view current, so an observer costs nothing beyond a callback, and a
     * caller that watched a path itself would both duplicate that work and see
     * less: diagnostics for one file change when a different file is edited,
     * and only a workspace-wide view catches that.
     */
    /** Source files written since this workspace opened. */
    changedFiles: (): readonly string[] => [...changedFiles],

    observeChanges(observer: (relativePath: string) => void): () => void {
      changeObservers.add(observer);
      return () => void changeObservers.delete(observer);
    },
    dispose,
  };

  async function dispose() {
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
  }
};

/**
 * An active language-server process scoped to one normalized workspace root.
 *
 * Requests observe watched filesystem changes and may be cancelled. The process
 * lives until `dispose` is called, keeping its TypeScript program warm across an
 * agent's think time, and a cancelled request disposes it because the work it
 * abandoned cannot be stopped any other way.
 */
export type VolarWorkspace = Awaited<ReturnType<typeof startVolarWorkspace>>;

/** Owns and reuses active workspaces until they become idle or the pool is disposed. */
export type VolarWorkspacePool = ReturnType<typeof createVolarWorkspaces>;

/**
 * Creates a pool that owns at most one active language-server process per
 * normalized workspace root.
 *
 * Concurrent calls to `get` for the same root share initialization. A failed or
 * exited process is removed so a later request starts a fresh workspace, and a
 * live one is kept for the session: its TypeScript program is the expensive
 * thing here, worth seconds to rebuild and milliseconds to reuse, so it outlasts
 * an agent's think time rather than being reclaimed between calls. Disposing the
 * pool closes every active process.
 */
/**
 * Presents a workspace already open at an outer root as one rooted here.
 *
 * Volar finds the configuration owning a file by walking up from the file, so a
 * server started at a monorepo already answers for every package inside it —
 * a second server for a package rebuilds that package's program, and with it
 * every declaration file behind it, since `volar-service-typescript` keys its
 * document registry on the root too. Naming the monorepo and then a package in
 * it is the ordinary way an agent reaches that.
 *
 * What cannot be shared is the root itself: a workspace resolves relative paths
 * against its own, and refuses files outside it. Handing back the outer
 * workspace resolved `src/render/gpu-cull.ts` against the monorepo. So the
 * connection is shared and the root is not — paths resolve here, and the
 * changed-file view is narrowed to this subtree and reported relative to it.
 */
const nestedWorkspace = (input: {
  readonly parent: VolarWorkspace;
  readonly parentRoot: string;
  readonly workspaceRoot: string;
}): VolarWorkspace => {
  const { parent, parentRoot, workspaceRoot } = input;
  const getWorkspaceUri = (file: string) => {
    const filePath = path.resolve(workspaceRoot, file);
    if (!isFileInDir(filePath, workspaceRoot)) {
      throw new Error(`File is outside the workspace: ${file}`);
    }
    return parent.getWorkspaceUri(filePath);
  };
  const here = (relativePath: string) => {
    const filePath = path.resolve(parentRoot, relativePath);
    return isFileInDir(filePath, workspaceRoot)
      ? path.relative(workspaceRoot, filePath)
      : undefined;
  };
  return {
    ...parent,
    getWorkspaceUri,
    async getTextDocument(file: string) {
      return await parent.getTextDocument(path.resolve(workspaceRoot, file));
    },
    changedFiles: () => parent.changedFiles().flatMap((file) => here(file) ?? []),
    observeChanges: (observer) =>
      parent.observeChanges((relativePath) => {
        const mine = here(relativePath);
        if (mine !== undefined) observer(mine);
      }),
    // The outer workspace owns the process; this handle is a view of it.
    dispose: async () => undefined,
  };
};

export const createVolarWorkspaces = (languageServer: URL) => {
  const entries = new Map<string, Promise<VolarWorkspace>>();

  /** Forgets an entry, unless it has already been replaced by a later one. */
  const forget = (workspaceRoot: string, held: Promise<VolarWorkspace>) => () => {
    if (entries.get(workspaceRoot) === held) entries.delete(workspaceRoot);
  };

  /** The open root that answers for this one: itself, or the outermost containing it. */
  const owner = (workspaceRoot: string) =>
    entries.has(workspaceRoot)
      ? workspaceRoot
      : [...entries.keys()].find((openRoot) => isFileInDir(workspaceRoot, openRoot));

  const get = (root: string): Promise<VolarWorkspace> => {
    const workspaceRoot = path.resolve(root);
    const existing = entries.get(workspaceRoot);
    if (existing) return existing;

    const parentRoot = owner(workspaceRoot);
    const parent = parentRoot === undefined ? undefined : entries.get(parentRoot);
    if (parent && parentRoot !== undefined) {
      const view = parent.then((active) =>
        nestedWorkspace({ parent: active, parentRoot, workspaceRoot }),
      );
      entries.set(workspaceRoot, view);
      const drop = forget(workspaceRoot, view);
      void parent.then(({ closed }) => closed.then(drop, drop), drop);
      return view;
    }

    const workspace = startVolarWorkspace(workspaceRoot, languageServer);
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
    /**
     * Ends a workspace's language server, if it has one.
     *
     * A semantic request cannot be cancelled — see
     * `docs/volar-affordance-evidence.md` § "Semantic requests cannot be
     * cancelled" — and while one runs the server holds its only thread and stops
     * reading IPC, so every later call for that workspace waits behind it. A
     * request abandoned at five seconds ran to completion at nearly ten, and a
     * folded five-line read needing no type checking timed out at thirty against
     * a workspace in that state. Ending the process is the only bound a client
     * has. The next call starts a fresh workspace, trading one program rebuild
     * for a queue with no bound but the abandoned work's own duration.
     */
    async release(root: string) {
      // Ends the server that answers for this root, which may be one opened at
      // an outer root; a view of it disposes to nothing, so releasing the view
      // would leave the wedged process running and every later call behind it.
      const serverRoot = owner(path.resolve(root));
      if (serverRoot === undefined) return;
      const held = entries.get(serverRoot);
      if (!held) return;
      entries.delete(serverRoot);
      await held.then(
        (active) => active.dispose(),
        () => undefined,
      );
    },
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
