import { fork } from "node:child_process";
import { totalmem } from "node:os";
import * as path from "pathe";
import {
  CancellationTokenSource,
  ConfigurationRequest,
  createProtocolConnection,
  type DidChangeWatchedFilesRegistrationOptions,
  DidChangeWatchedFilesNotification,
  ExitNotification,
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
} from "vscode-languageserver-protocol/node.js";
import { URI } from "vscode-uri";
import { clientCapabilities, getClientConfiguration } from "./language-client.ts";
import type { RequestTrace } from "@type-atlas/atlascii";

const observed: { entries: RequestTrace[] } = { entries: [] };

const noteRequest = (trace: RequestTrace): void => {
  observed.entries.push(trace);
};

export const takeRequestTraces = (): readonly RequestTrace[] => {
  const entries = observed.entries;
  observed.entries = [];
  return entries;
};

/**
 * Heap ceiling for a language server.
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
const heapMegabytes = () =>
  Math.max(2048, Math.min(8192, Math.floor(totalmem() / 1024 / 1024 / 2)));

/**
 * How long one request may hold the language server before it is ended.
 *
 * Longer than the slowest legitimate answer measured here — a cold whole-project
 * check of a three-thousand-file program — so a slow project is not mistaken for
 * a stuck one.
 */
const requestDeadline = 60_000;

/**
 * Runs one Volar language server and speaks LSP to it.
 *
 * This owns the process and the protocol: forking, the handshake, the watcher
 * registrations Volar asks the client to keep, request cancellation, and
 * shutdown. It knows nothing about which files a workspace contains — a caller
 * supplies file changes and asks questions about URIs.
 */
export const startLanguageServerProcess = (input: {
  readonly workspaceRoot: string;
  readonly entry: URL;
}) => {
  const { workspaceRoot, entry } = input;
  const child = fork(entry, ["--node-ipc"], {
    cwd: workspaceRoot,
    execArgv: [`--max-old-space-size=${heapMegabytes()}`],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  // Set before the connection is disposed, because disposing rejects every
  // pending request and `child.exitCode` is not updated yet when that rejection
  // lands. Asking the child whether it is running reported "yes" for a process
  // that had just died, so the exit went unnamed and the caller received
  // `Pending response rejected since connection got disposed` — the transport's
  // words for a crash it cannot describe.
  const exit = { closed: false };
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => {
      exit.closed = true;
      resolve();
    }),
  );
  const failure: { error?: Error } = {};
  child.on("error", (error) => {
    failure.error = error;
  });
  /**
   * The child's last words.
   *
   * Inheriting stderr sent a crash to this process's own output, where the tool
   * reporting the crash could not reach it: every language-server death arrived
   * as `exit code 1` and nothing else, so a reproducible failure — every
   * Markdown request killing the server — was indistinguishable from a transient
   * one. Keeping the tail costs a few kilobytes and turns an opaque exit into
   * the stack that caused it.
   */
  const stderr: string[] = [];
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr.push(chunk);
    if (stderr.length > 40) stderr.splice(0, stderr.length - 40);
  });
  const running = () => !exit.closed && child.exitCode === null && child.signalCode === null;
  const terminate = () => {
    if (running()) child.kill("SIGKILL");
  };
  /**
   * Whether the process aborted, which is the one exit a repeat cannot fix.
   *
   * `SIGABRT` says the process killed itself, not why. It has been V8 refusing
   * to grow the heap, and it has been the native TypeScript bridge crashing in
   * Go — the same signal, different causes, and only the tail below tells them
   * apart. Naming a cause here asserted the wrong one for months.
   */
  const aborted = () => child.signalCode === "SIGABRT";
  const exitReason = () =>
    failure.error?.message ??
    (aborted()
      ? "it aborted"
      : child.signalCode
        ? `killed by ${child.signalCode}`
        : `exit code ${child.exitCode}`);
  const lastWords = () => {
    const text = stderr.join("").trimEnd();
    if (!text) return "";
    const tail = text.split("\n").slice(-8).join("\n");
    return `\n\nIt said:\n${tail}`;
  };

  const connection = createProtocolConnection(
    new IPCMessageReader(child),
    new IPCMessageWriter(child),
  );
  child.once("close", () => connection.dispose());
  connection.listen();
  connection.onRequest(ConfigurationRequest.type, ({ items }) =>
    items.map(({ section }) => getClientConfiguration(section)),
  );
  // The headless client has no displayed editor cache to refresh, so
  // acknowledging is the complete host action; the next call pulls fresh
  // results. Without these, Volar warns about an unsupported capability after
  // every watched edit.
  connection.onRequest(InlayHintRefreshRequest.type, () => undefined);
  connection.onRequest(SemanticTokensRefreshRequest.type, () => undefined);

  const registrations = new Map<string, DidChangeWatchedFilesRegistrationOptions>();
  const { promise: registered, resolve: resolveRegistration } = Promise.withResolvers<void>();
  connection.onRequest(RegistrationRequest.type, ({ registrations: items }) => {
    for (const registration of items) {
      if (registration.method !== DidChangeWatchedFilesNotification.method) continue;
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

  /**
   * Completes the LSP handshake, once, on the first request that needs it.
   *
   * Reading a file, sizing it, and resolving its uri are filesystem work the
   * caller can do alone, and they are the most common thing asked of a
   * workspace. Initializing first made them wait a second for a TypeScript
   * server they never spoke to.
   */
  const ready = (async () => {
    const workspaceUri = URI.file(workspaceRoot).toString();
    await connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: workspaceUri,
      workspaceFolders: [{ uri: workspaceUri, name: path.basename(workspaceRoot) }],
      capabilities: clientCapabilities,
    });
    await connection.sendNotification(InitializedNotification.type, {});
    await Promise.race([
      registered,
      closed.then(() => {
        throw failure.error ?? new Error("The language server exited during initialization.");
      }),
    ]);
  })();
  // Nothing awaits this until a request does, so an unhandled rejection here
  // would crash the process before that.
  void ready.catch(() => undefined);

  /**
   * Ends the server when a request has plainly stopped answering.
   *
   * A semantic request cannot be cancelled — see
   * `docs/volar-affordance-evidence.md` § "Semantic requests cannot be
   * cancelled": the token Volar hands TypeScript raises nothing, and a request
   * abandoned at five seconds ran to completion at nearly ten. While it runs the
   * server holds its only thread and stops reading its socket, so every later
   * call waits behind it — a folded five-line read needing no type checking has
   * timed out at thirty seconds that way. Ending the process is the only bound a
   * client has.
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
        terminate();
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

  const flight = { active: 0, served: 0 };

  const sendRequest = async <Params, Result, Error>(
    request: RequestType<Params, Result, Error>,
    params: Params,
    signal?: AbortSignal,
  ): Promise<Result> => {
    await ready;
    signal?.throwIfAborted();
    const startedAt = performance.now();
    const queuedBehind = flight.active;
    const firstAfterStart = flight.served === 0;
    flight.active += 1;
    const cancellation = signal ? new CancellationTokenSource() : undefined;
    const cancel = () => cancellation?.cancel();
    signal?.addEventListener("abort", cancel, { once: true });

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
      if (!running()) {
        throw new Error(
          // Leading with "narrow it" names a cause this has not established. An
          // exit is usually not about the size of the question: the server
          // starts again on the next call and the program it had built is still
          // on disk, so repeating the same request verbatim is what answers it.
          // Narrowing is the escalation after that fails, not the first move.
          aborted()
            ? `The language server for ${workspaceRoot} exited during this request: ${exitReason()}. An abort here has been deterministic every time it has been seen, so repeating the same call is unlikely to answer it. The tail below says where it died — frames from typescript-go are the native checker crashing, which no amount of memory changes; a heap exhaustion says so in its own words. Meanwhile, ask about less at once: a smaller project, or a file-scoped tool, which reports that file's diagnostics without checking the whole program.${lastWords()}`
            : `The language server for ${workspaceRoot} exited during this request (${exitReason()}). Repeat the same call — the server starts again and reuses the program it already built. If it keeps ending here, the exit is deterministic and the request is the cause.${lastWords()}`,
          { cause: failure.error ?? error },
        );
      }
      throw error;
    } finally {
      flight.active -= 1;
      flight.served += 1;
      noteRequest({
        method: request.method,
        elapsedMs: Math.round(performance.now() - startedAt),
        queuedBehind,
        firstAfterStart,
      });
      deadline.clear();
      signal?.removeEventListener("abort", cancel);
      cancellation?.dispose();
    }
  };

  /**
   * Reports a file change to the language server.
   *
   * Volar clears its read cache and bumps the project version from this
   * notification alone (`features/fileSystem.js`, `project/typescriptProjectLs.js`),
   * and it is the only thing that does: nothing in `@volar/language-server` or
   * any `volar-service-*` ever calls the server's own `watchFiles`, so no
   * watcher glob is ever registered. Sending only what a registration matched
   * therefore sent nothing at all, and every diagnostic answered from the
   * contents read when a file was first opened. The watcher already skips
   * `.git`, `node_modules`, and submodules, so this reports source changes.
   */
  const notifyFileChanges = async (relativePath: string, types: readonly FileChangeType[]) => {
    const uri = URI.file(path.resolve(workspaceRoot, relativePath)).toString();
    await connection.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: types.map((type) => ({ uri, type })),
    });
  };

  return {
    closed,
    ready,
    sendRequest,
    notifyFileChanges,
    sendNotification: connection.sendNotification.bind(connection),
    terminate,
    async shutdown() {
      // A server that will not shut down politely still has to go, and its exit
      // is what releases the pool entry.
      const forced = setTimeout(terminate, 2_000);
      forced.unref();
      try {
        if (running()) {
          await connection.sendRequest(ShutdownRequest.type);
          await connection.sendNotification(ExitNotification.type);
        }
      } catch {
        terminate();
      } finally {
        clearTimeout(forced);
      }
      await closed;
    },
  };
};

/** One running language server, addressed over LSP. */
export type LanguageServerProcess = ReturnType<typeof startLanguageServerProcess>;
