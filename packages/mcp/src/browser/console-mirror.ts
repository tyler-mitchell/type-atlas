/**
 * console-mirror — ambient mirror of the browser console to a file.
 *
 * Event-driven (no polling): asks agent-browser for the browser's CDP endpoint
 * (`get cdp-url`), connects Node's built-in WebSocket, auto-attaches to every
 * page/worker target, and appends console events as they fire:
 *   Runtime.consoleAPICalled  → log/info/warn/error/…
 *   Runtime.exceptionThrown   → uncaught exceptions (with stack)
 *   Log.entryAdded            → network/CSP/deprecation entries
 *
 * Runs IN-PROCESS inside the MCP server so it works identically from the
 * source/tsx runtime and the bundled CJS dist (no import.meta, no spawned
 * daemon). Control surface: consoleMirror(action, opts) → start | stop | status.
 */
import { execFile } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const STATE_DIR = resolve(ROOT, ".featuretype-browser");
const DEFAULT_OUT = resolve(STATE_DIR, "console.log");

export type MirrorResult = {
  running: boolean;
  out: string;
  session?: string;
  lines?: number;
  bytes?: number;
  startedAt?: string;
  message: string;
  error?: boolean;
};

type Controller = { out: string; session?: string; startedAt: string; close: () => void };
let controller: Controller | null = null;

const LEVEL: Record<string, string> = { warning: "warn", startGroup: "group", endGroup: "groupEnd" };

type RemoteObject = {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  preview?: { properties?: { name: string; value: string }[]; subtype?: string };
};

function renderArg(a: RemoteObject): string {
  if ("value" in a && a.value !== undefined) {
    return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
  }
  if (a.preview?.properties) {
    const body = a.preview.properties.map((p) => `${p.name}: ${p.value}`).join(", ");
    return a.preview.subtype === "array" ? `[${body}]` : `{${body}}`;
  }
  return a.description ?? a.type ?? "undefined";
}

const frame = (st?: { callFrames?: { url?: string; lineNumber?: number; columnNumber?: number }[] }): string => {
  const f = st?.callFrames?.[0];
  if (!f?.url) return "";
  return ` (${f.url}:${(f.lineNumber ?? 0) + 1}:${(f.columnNumber ?? 0) + 1})`;
};

function startMirror(out: string, session: string | undefined, maxBytes: number): Controller {
  mkdirSync(dirname(out), { recursive: true });
  const startedAt = new Date().toISOString();
  appendFileSync(out, `# console mirror (CDP stream) started ${startedAt} session=${session ?? "default"}\n`);

  const write = (level: string, text: string, suffix = "") => {
    if (maxBytes > 0) {
      try {
        if (statSync(out).size > maxBytes) renameSync(out, `${out}.1`);
      } catch {
        /* file may not exist yet */
      }
    }
    const ts = new Date().toISOString();
    const lines = `${text}${suffix}`.split("\n");
    const head = `${ts}  ${(LEVEL[level] ?? level).padEnd(9)} ${lines[0]}`;
    const rest = lines.slice(1).map((l) => `    ${l.trim()}`).filter((l) => l.trim());
    appendFileSync(out, `${[head, ...rest].join("\n")}\n`);
  };

  const cdpUrl = async (): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync(
        "agent-browser",
        ["get", "cdp-url", "--json", ...(session ? ["--session", session] : [])],
      );
      return (JSON.parse(stdout) as { data?: { cdpUrl?: string } }).data?.cdpUrl ?? null;
    } catch {
      return null;
    }
  };

  let closed = false;
  let ws: WebSocket | undefined;
  let id = 0;

  const connect = async () => {
    if (closed) return;
    const url = await cdpUrl();
    if (!url) {
      if (!closed) setTimeout(() => void connect(), 1500); // no browser yet — wait
      return;
    }
    const socket = new WebSocket(url);
    ws = socket;
    const send = (method: string, params: unknown, sessionId?: string) =>
      socket.send(JSON.stringify({ id: ++id, method, params: params ?? {}, ...(sessionId ? { sessionId } : {}) }));

    socket.addEventListener("open", () =>
      send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }),
    );
    socket.addEventListener("message", (ev: MessageEvent) => {
      const m = JSON.parse(String(ev.data)) as { method?: string; params?: any };
      switch (m.method) {
        case "Target.attachedToTarget": {
          const sid = m.params.sessionId as string;
          const type = m.params.targetInfo?.type as string;
          if (type === "page" || type === "iframe" || type === "worker" || type === "service_worker") {
            send("Runtime.enable", {}, sid);
            send("Log.enable", {}, sid);
            send("Runtime.runIfWaitingForDebugger", {}, sid);
          }
          break;
        }
        case "Runtime.consoleAPICalled": {
          const args = (m.params.args as RemoteObject[]).map(renderArg).join(" ");
          write(String(m.params.type ?? "log"), args, frame(m.params.stackTrace));
          break;
        }
        case "Runtime.exceptionThrown": {
          const d = m.params.exceptionDetails ?? {};
          write("exception", String(d.exception?.description ?? d.text ?? "Uncaught exception"), frame(d.stackTrace));
          break;
        }
        case "Log.entryAdded": {
          const e = m.params.entry ?? {};
          write(String(e.level ?? "info"), String(e.text ?? ""), e.url ? ` (${e.url})` : "");
          break;
        }
      }
    });
    socket.addEventListener("close", () => {
      if (!closed) setTimeout(() => void connect(), 1500); // browser restarted
    });
    socket.addEventListener("error", () => {
      try {
        socket.close();
      } catch {
        /* noop */
      }
    });
  };
  void connect();

  return {
    out,
    session,
    startedAt,
    close: () => {
      closed = true;
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    },
  };
}

/** Programmatic control surface (used by the MCP tool). */
export function consoleMirror(
  action: "start" | "stop" | "status",
  opts: { out?: string; session?: string; maxBytes?: number } = {},
): MirrorResult {
  const out = resolve(opts.out ?? DEFAULT_OUT);
  if (action === "start") {
    if (controller) {
      return {
        running: true,
        out: controller.out,
        session: controller.session,
        startedAt: controller.startedAt,
        error: true,
        message: `already running → ${controller.out}`,
      };
    }
    controller = startMirror(out, opts.session, opts.maxBytes ?? 10 * 1024 * 1024);
    return {
      running: true,
      out: controller.out,
      session: controller.session,
      startedAt: controller.startedAt,
      message: `console mirror on → ${controller.out} (CDP stream, session=${controller.session ?? "default"})`,
    };
  }
  if (action === "stop") {
    if (!controller) return { running: false, out, message: "console mirror off (nothing running)" };
    const c = controller;
    controller = null;
    c.close();
    return { running: false, out: c.out, message: `console mirror off (was → ${c.out})` };
  }
  if (!controller) return { running: false, out, message: "console mirror off" };
  let bytes = 0;
  let lines = 0;
  try {
    bytes = statSync(controller.out).size;
    lines = readFileSync(controller.out, "utf8").split("\n").filter(Boolean).length;
  } catch {
    /* not written yet */
  }
  return {
    running: true,
    out: controller.out,
    session: controller.session,
    startedAt: controller.startedAt,
    lines,
    bytes,
    message: `console mirror on → ${controller.out} · ${lines} lines / ${bytes} bytes · session=${controller.session ?? "default"}`,
  };
}
