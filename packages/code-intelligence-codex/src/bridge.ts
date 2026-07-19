#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { execa } from "execa";
import type {
  DynamicToolProvider,
  DynamicToolProviderEnvironment,
  DynamicToolSpec,
} from "./provider.ts";

type JsonObject = Record<string, unknown>;
type RequestId = string | number;
type RuntimeModule = {
  readonly createProviders: (
    environment: DynamicToolProviderEnvironment,
  ) => readonly DynamicToolProvider[] | Promise<readonly DynamicToolProvider[]>;
};
type Runtime = {
  readonly tools: readonly DynamicToolSpec[];
  readonly providers: ReadonlyMap<string, DynamicToolProvider>;
  activeCalls: number;
  retired: boolean;
  disposal?: Promise<void>;
};

const realCodex = process.env.CODEX_DYNAMIC_TOOLS_CODEX_PATH ??
  "/Applications/ChatGPT.app/Contents/Resources/codex";

const toolKey = (namespace: string | null, tool: string) =>
  `${namespace ?? ""}\0${tool}`;

const specKeys = (spec: DynamicToolSpec) => spec.type === "namespace"
  ? spec.tools.map((tool) => toolKey(spec.name, tool.name))
  : [toolKey(null, spec.name)];

const asObject = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;

const asRequestId = (value: unknown): RequestId | undefined =>
  typeof value === "string" || typeof value === "number" ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const parseMessage = (line: string): JsonObject | undefined => {
  try {
    return asObject(JSON.parse(line));
  } catch {
    return undefined;
  }
};

const writeLine = (stream: NodeJS.WritableStream, value: unknown) =>
  stream.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);

const errorMessage = (value: unknown): string => {
  const error = asObject(value);
  return asString(error?.message) ?? String(value);
};

const runAppServer = async (args: readonly string[]): Promise<number> => {
  const child = execa(realCodex, args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    reject: false,
  });
  const packageRoot = path.resolve(__dirname, "..");
  const providerEntry = path.resolve(
    process.env.CODEX_DYNAMIC_TOOLS_ENTRY ?? path.join(packageRoot, "src/runtime.ts"),
  );
  const providerModule = providerEntry.startsWith(`${packageRoot}${path.sep}`)
    ? `/${path.relative(packageRoot, providerEntry).split(path.sep).join("/")}`
    : `/@fs/${providerEntry}`;
  const languageServerEntry = pathToFileURL(
    path.join(__dirname, "language-server.cjs"),
  );
  const { createServer } = await import("vite");
  let reloadRuntime = () => Promise.resolve();
  const vite = await createServer({
    root: packageRoot,
    server: { middlewareMode: true, watch: { usePolling: true } },
    appType: "custom",
    logLevel: "silent",
  });
  const disposals = new Set<Promise<void>>();

  const disposeRuntime = (value: Runtime) => {
    if (value.disposal) return value.disposal;
    const disposal = Promise.allSettled(
      [...new Set(value.providers.values())].map((provider) => provider.dispose?.()),
    ).then(() => undefined).finally(() => disposals.delete(disposal));
    value.disposal = disposal;
    disposals.add(disposal);
    return disposal;
  };
  const createRuntime = async (): Promise<Runtime> => {
    const loaded = await vite.ssrLoadModule(providerModule) as RuntimeModule;
    const providers = await loaded.createProviders({ languageServer: languageServerEntry });
    const registry = new Map<string, DynamicToolProvider>();
    for (const provider of providers) {
      for (const spec of provider.tools) {
        for (const key of specKeys(spec)) {
          if (registry.has(key)) throw new Error(`Duplicate dynamic tool: ${key}`);
          registry.set(key, provider);
        }
      }
    }
    return {
      tools: providers.flatMap((provider) => provider.tools),
      providers: registry,
      activeCalls: 0,
      retired: false,
    };
  };
  const retireRuntime = (value: Runtime) => {
    value.retired = true;
    if (value.activeCalls === 0) {
      void disposeRuntime(value).catch((error) =>
        process.stderr.write(`Dynamic tool shutdown failed: ${errorMessage(error)}\n`)
      );
    }
  };
  let runtime = await createRuntime();
  let reloadTask = Promise.resolve();
  reloadRuntime = () => {
    const task = reloadTask.then(async () => {
      const previous = runtime;
      runtime = await createRuntime();
      retireRuntime(previous);
    });
    reloadTask = task.catch(() => undefined);
    return task;
  };
  vite.watcher.on("all", (_event, file) => {
    if (vite.moduleGraph.getModulesByFile(file)?.size) {
      setImmediate(() => void reloadRuntime());
    }
  });
  const requests = new Map<
    RequestId,
    { readonly method: string; readonly params: JsonObject }
  >();
  const internalRequests = new Map<
    RequestId,
    (message: JsonObject) => void
  >();
  const roots = new Map<string, string>();
  const changedFiles = new Map<string, Set<string>>();

  const captureFileChange = (threadId: string, itemValue: unknown) => {
    const item = asObject(itemValue);
    if (item?.type !== "fileChange" || !Array.isArray(item.changes)) return;
    const files = changedFiles.get(threadId) ?? new Set<string>();
    for (const value of item.changes) {
      const file = asString(asObject(value)?.path);
      if (file !== undefined) files.add(file);
    }
    changedFiles.set(threadId, files);
  };

  const captureThread = (threadValue: unknown, fallbackCwd?: unknown) => {
    const thread = asObject(threadValue);
    const threadId = asString(thread?.id);
    if (threadId === undefined) return;
    const cwd = asString(thread?.cwd) ?? asString(fallbackCwd);
    if (cwd !== undefined) roots.set(threadId, cwd);
    if (!Array.isArray(thread?.turns)) return;
    for (const turnValue of thread.turns) {
      const turn = asObject(turnValue);
      if (!Array.isArray(turn?.items)) continue;
      for (const item of turn.items) captureFileChange(threadId, item);
    }
  };

  const readThread = (threadId: string) =>
    new Promise<void>((resolve, reject) => {
      const id = `code-intelligence:${randomUUID()}`;
      internalRequests.set(id, (message) => {
        if (message.error !== undefined) {
          reject(new Error(errorMessage(message.error)));
          return;
        }
        const result = asObject(message.result);
        captureThread(result?.thread, result?.cwd);
        resolve();
      });
      writeLine(child.stdin!, {
        id,
        method: "thread/read",
        params: { threadId, includeTurns: true },
      });
    });

  const handleClientLine = (line: string) => {
    const message = parseMessage(line);
    const id = asRequestId(message?.id);
    const method = asString(message?.method);
    const params = asObject(message?.params);
    if (message === undefined || method === undefined || params === undefined) {
      writeLine(child.stdin!, line);
      return;
    }

    if (id !== undefined && ["thread/start", "thread/resume", "thread/fork"].includes(method)) {
      requests.set(id, { method, params });
    }

    if (method === "turn/start") {
      const threadId = asString(params.threadId);
      const cwd = asString(params.cwd);
      if (threadId !== undefined && cwd !== undefined) roots.set(threadId, cwd);
    }

    if (method === "initialize") {
      const capabilities = asObject(params.capabilities) ?? {};
      writeLine(child.stdin!, {
        ...message,
        params: {
          ...params,
          capabilities: { ...capabilities, experimentalApi: true },
        },
      });
      return;
    }

    if (method === "thread/start") {
      void reloadTask.then(() => {
        const existing = Array.isArray(params.dynamicTools) ? params.dynamicTools : [];
        writeLine(child.stdin!, {
          ...message,
          params: { ...params, dynamicTools: [...existing, ...runtime.tools] },
        });
      });
      return;
    }

    writeLine(child.stdin!, line);
  };

  const handleServerLine = async (line: string) => {
    const message = parseMessage(line);
    const id = asRequestId(message?.id);
    if (message === undefined) {
      writeLine(process.stdout, line);
      return;
    }

    if (id !== undefined) {
      const internal = internalRequests.get(id);
      if (internal !== undefined) {
        internalRequests.delete(id);
        internal(message);
        return;
      }
      const request = requests.get(id);
      if (request !== undefined && (message.result !== undefined || message.error !== undefined)) {
        requests.delete(id);
        const result = asObject(message.result);
        captureThread(result?.thread, result?.cwd ?? request.params.cwd);
      }
    }

    const params = asObject(message.params);
    const item = asObject(params?.item);
    const threadId = asString(params?.threadId);
    if (threadId !== undefined && item !== undefined) {
      captureFileChange(threadId, item);
      if (item.type === "thread") captureThread(item);
    }
    if (asString(message.method) === "thread/started") {
      captureThread(params?.thread);
    }

    if (
      message.method !== "item/tool/call" ||
      id === undefined ||
      params === undefined
    ) {
      writeLine(process.stdout, line);
      return;
    }

    const dynamic = runtime;
    const namespace = params.namespace === null ? null : asString(params.namespace);
    const tool = asString(params.tool);
    if (namespace === undefined || tool === undefined) {
      writeLine(process.stdout, line);
      return;
    }
    const provider = dynamic.providers.get(toolKey(namespace, tool));
    if (provider === undefined) {
      writeLine(process.stdout, line);
      return;
    }

    const callThreadId = asString(params.threadId);
    const turnId = asString(params.turnId);
    const callId = asString(params.callId);
    if (callThreadId === undefined || turnId === undefined || callId === undefined) {
      writeLine(child.stdin!, {
        id,
        result: {
          contentItems: [{
            type: "inputText",
            text: "The dynamic tool request is missing its task or tool identifier.",
          }],
          success: false,
        },
      });
      return;
    }

    try {
      dynamic.activeCalls += 1;
      if (!roots.has(callThreadId)) await readThread(callThreadId);
      const root = roots.get(callThreadId);
      if (root === undefined) throw new Error("The task workspace is unavailable.");
      const output = await provider.call(
        {
          root,
          changedFiles: [...(changedFiles.get(callThreadId) ?? [])],
        },
        {
          threadId: callThreadId,
          turnId,
          callId,
          namespace,
          tool,
          arguments: params.arguments,
        },
        new AbortController().signal,
      );
      writeLine(child.stdin!, {
        id,
        result: {
          contentItems: output,
          success: true,
        },
      });
    } catch (error) {
      writeLine(child.stdin!, {
        id,
        result: {
          contentItems: [{
            type: "inputText",
            text: error instanceof Error ? error.message : String(error),
          }],
          success: false,
        },
      });
    } finally {
      dynamic.activeCalls -= 1;
      if (dynamic.retired && dynamic.activeCalls === 0) {
        void disposeRuntime(dynamic).catch((error) =>
          process.stderr.write(`Dynamic tool shutdown failed: ${errorMessage(error)}\n`)
        );
      }
    }
  };

  const clientLines = createInterface({ input: process.stdin });
  clientLines.on("line", handleClientLine);
  clientLines.once("close", () => child.stdin?.end());

  const pending = new Set<Promise<void>>();
  const serverLines = createInterface({ input: child.stdout! });
  serverLines.on("line", (line) => {
    const task = handleServerLine(line).finally(() => pending.delete(task));
    pending.add(task);
  });

  const stop = (signal: NodeJS.Signals) => child.kill(signal);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => stop(signal));
  }

  const { exitCode } = await child;
  clientLines.close();
  serverLines.close();
  await vite.close();
  await Promise.allSettled([...pending]);
  await disposeRuntime(runtime);
  await Promise.allSettled([...disposals]);
  return exitCode ?? 1;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (!args.includes("app-server")) {
    const { exitCode } = await execa(realCodex, args, {
      stdio: "inherit",
      reject: false,
    });
    return exitCode ?? 1;
  }
  return runAppServer(args);
};

void main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
