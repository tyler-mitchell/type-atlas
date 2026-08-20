import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";
import { watch } from "chokidar";
import * as path from "pathe";
import {
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  FileChangeType,
  type RequestType,
} from "vscode-languageserver-protocol/node.js";
import { isFileInDir } from "@volar/language-server/node.js";
import { GetMatchTsConfigRequest } from "@volar/language-server/protocol.js";
import { URI } from "vscode-uri";
import { startLanguageServerProcess } from "./language-server-process.ts";
import { containingGitSubmodule, findGitSubmoduleRoots } from "./git-submodules.ts";

/** Files a TypeScript project can report diagnostics for. */
const sourceFile = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

/**
 * Whether an installed file belongs to a package manager serving this root.
 *
 * A dependency is not named by a caller — TypeScript resolved it from an import
 * inside the workspace — and a package manager installs above the package that
 * depends on it. So a workspace opened at one package of a monorepo reaches its
 * dependencies through a `node_modules` its own root does not contain, and
 * containment alone refused them: every `search_dependency_code` from a nested
 * root answered `File is outside the workspace`.
 *
 * The widening is exactly hoisting and nothing else. What sits before the first
 * `node_modules` is where the manager put the tree, and that must be this root
 * or something above it, so an unrelated checkout's `node_modules` stays out.
 */
const installedForThisRoot = (filePath: string, workspaceRoot: string) => {
  const marker = filePath.indexOf("/node_modules/");
  if (marker < 0) return false;
  const installedUnder = filePath.slice(0, marker);
  return workspaceRoot === installedUnder || isFileInDir(workspaceRoot, installedUnder);
};

const startVolarWorkspace = async (workspaceRoot: string, languageServerEntry: URL) => {
  const workspaceStat = await stat(workspaceRoot).catch(() => undefined);
  if (!workspaceStat?.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
  }
  const submoduleRoots = await findGitSubmoduleRoots(workspaceRoot);

  const watcherFailure: { error?: Error } = {};
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
      return (
        containingGitSubmodule(path.resolve(workspaceRoot, file), submoduleRoots) !== undefined
      );
    },
    ignoreInitial: true,
    followSymlinks: false,
  });

  const server = startLanguageServerProcess({ workspaceRoot, entry: languageServerEntry });
  server.closed.then(
    () => void watcher.close(),
    () => void watcher.close(),
  );

  // Volar registers its watchers during the handshake, so a change seen before
  // that has nowhere to go; the watcher is wired once the server is ready.
  const watching = server.ready
    .then(() => {
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
        void server
          .notifyFileChanges(relativePath, types)
          .then(() =>
            path.matchesGlob(relativePath, "**/node_modules/{*,@*/*}")
              ? server.notifyFileChanges(path.join(relativePath, "package.json"), types)
              : undefined,
          )
          .catch((error: unknown) => {
            watcherFailure.error = error instanceof Error ? error : new Error(String(error));
          });
      });
      watcher.on("error", (error) => {
        watcherFailure.error = error;
      });
    })
    .catch(async (error: unknown) => {
      await watcher.close();
      server.terminate();
      throw error;
    });
  void watching.catch(() => undefined);

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
    if (!isFileInDir(filePath, workspaceRoot) && !installedForThisRoot(filePath, workspaceRoot)) {
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
  const typeScriptDocument = /\.(?:[cm]?tsx?|[cm]?jsx?)$/i;
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
    // Only for a document a TypeScript project can own. Resolving a tsconfig is
    // safe on its own — measured: the server survives it for a file no project
    // owns — but it is wasted work for a file that can never have one.
    if (!typeScriptDocument.test(uri)) return;
    void sendRequest(GetMatchTsConfigRequest.type, { uri }).catch(() => undefined);
  };
  /**
   * Asks the language server, refusing first if this workspace's view of the
   * filesystem has failed — an answer computed from a stale file view is worse
   * than none, and the watcher is the only thing keeping that view current.
   */
  const sendRequest = async <Params, Result, Error>(
    request: RequestType<Params, Result, Error>,
    params: Params,
    signal?: AbortSignal,
  ): Promise<Result> => {
    // Awaiting the watcher, not just the handshake: the watcher is wired once
    // the server is ready, and a request answered before that would leave an
    // edit made in the meantime out of this workspace's changed-file view.
    await watching;
    if (watcherFailure.error) throw watcherFailure.error;
    return await server.sendRequest(request, params, signal);
  };

  const readTextDocumentUri = async (uri: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const source = await readFile(fileURLToPath(uri), "utf8").catch(() => undefined);
    if (source === undefined) {
      throw new Error(`Source document is unavailable: ${uri}`);
    }
    return { textDocument: { uri }, source };
  };
  return {
    closed: server.closed,
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
    /** Where this workspace is rooted — a view's own root, not the server's. */
    root: workspaceRoot,
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
      await server.ready;
      const preceding = openDocuments.get(uri) ?? Promise.resolve();
      const attempt = preceding.then(async () => {
        signal?.throwIfAborted();
        // Opening a real file's uri with text that differs from disk poisons
        // the platform: Volar stores the OPENED text in a cache keyed by the
        // DISK mtime (updateFsCacheFromSyncedDocument), the tool never
        // writes, so the poison outlives the close and the file answers with
        // the synthetic text for the rest of the session — verify_edit's
        // closed proposal flipped explore_symbol's corpus with run breadth.
        // No after-the-fact cure worked: cache rewrites, watched-file pings,
        // mtime touches all lost a race to the bridge's own async state.
        // So don't poison: open with DISK text (cache write is a no-op),
        // then EDIT to the synthetic text — an honest versioned didChange,
        // the editor path — and edit back before the close. A probe's uri
        // has no disk file and opens directly with its text.
        const onDisk = await readFile(fileURLToPath(uri), "utf8").catch(() => undefined);
        const editedOverDisk = onDisk !== undefined && onDisk !== source;
        await server.sendNotification(DidOpenTextDocumentNotification.type, {
          textDocument: {
            uri,
            languageId,
            version: ++documentVersion,
            text: editedOverDisk ? onDisk : source,
          },
        });
        if (editedOverDisk) {
          await server.sendNotification(DidChangeTextDocumentNotification.type, {
            textDocument: { uri, version: ++documentVersion },
            contentChanges: [{ text: source }],
          });
        }
        try {
          return await task({ uri });
        } finally {
          // Closing on a dead connection is moot, and a throw here replaces
          // the task's own error: a language-server death mid-task surfaced
          // as a bare "Connection is disposed" from this close, masking the
          // exit report that named the crash, for as long as it could throw.
          try {
            if (editedOverDisk) {
              await server.sendNotification(DidChangeTextDocumentNotification.type, {
                textDocument: { uri, version: ++documentVersion },
                contentChanges: [{ text: onDisk }],
              });
            }
            await server.sendNotification(DidCloseTextDocumentNotification.type, {
              textDocument: { uri },
            });
          } catch {
            // The close is owed to a live connection only.
          }
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

    /**
     * Tells the language server about every write this workspace has seen,
     * and waits for it to have been told.
     *
     * The watcher sends each change without awaiting it, so a question asked
     * immediately after a write could be answered from a program that had not
     * seen it — `scope: "changed"` reported two errors that no longer existed,
     * at positions its own frames then rendered against the new text, so the
     * carets underlined unrelated code. An answer that is stale and fast is
     * worse than a slow one: nothing in it says which it is.
     */
    async flushChanges(): Promise<void> {
      // Delivery is what matters, not acceptance. A server that refuses one
      // change — an inferred project the native checker does not hold answers
      // `project not found for update` — must not take the request with it: the
      // watcher's own notifications were fire-and-forget, so awaiting them
      // turned a swallowed failure into a dead call.
      await Promise.all(
        [...changedFiles].map((relativePath) =>
          server.notifyFileChanges(relativePath, [FileChangeType.Changed]).catch(() => undefined),
        ),
      );
    },

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
    await server.shutdown();
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
    if (!isFileInDir(filePath, workspaceRoot) && !installedForThisRoot(filePath, workspaceRoot)) {
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
    root: workspaceRoot,
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
