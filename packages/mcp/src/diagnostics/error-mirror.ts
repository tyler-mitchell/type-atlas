/**
 * ts-error-mirror — ambient mirror of project diagnostics to a file.
 *
 * Built entirely from what already exists:
 *   - the MCP server's warm HostManager session (no second language server),
 *   - the canonical getDiagnostics() aggregator + formatter (no hand-rolled pull),
 *   - the language server's onDiagnosticsRefresh push, which the existing
 *     notify_file_changed flow already triggers (no file watcher).
 *
 * `start` returns instantly and wires up in the background; the snapshot is
 * (re)written whenever the language server pushes a diagnostic refresh.
 *
 * Control surface: tsErrorMirror(action, getSession, opts) → start | stop | status.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import { getDiagnostics } from "../tools/diagnostics.js";

const STATE_DIR = resolve(process.cwd(), ".featuretype-diagnostics");
const DEFAULT_OUT = resolve(STATE_DIR, "errors.txt");

export type TsMirrorResult = {
  running: boolean;
  state?: "starting" | "running" | "error";
  out: string;
  message: string;
  error?: boolean;
};

type SessionProvider = () => Promise<DiagnosticsSession>;
type State = {
  out: string;
  status: "starting" | "running" | "error";
  error?: string;
  unsubscribe?: () => void;
  cancelled: boolean;
};
let state: State | null = null;

export function tsErrorMirror(
  action: "start" | "stop" | "status",
  getSession: SessionProvider,
  opts: { out?: string; errorsOnly?: boolean } = {},
): TsMirrorResult {
  const out = resolve(opts.out ?? DEFAULT_OUT);

  if (action === "start") {
    if (state && state.status !== "error") {
      return {
        running: state.status === "running",
        state: state.status,
        out: state.out,
        error: true,
        message: `already ${state.status} → ${state.out}`,
      };
    }
    const s: State = { out, status: "starting", cancelled: false };
    state = s;
    // Wire up in the background — never block the tool call.
    void (async () => {
      try {
        const session = await getSession(); // the MCP's existing warm session
        if (s.cancelled) return;
        mkdirSync(dirname(out), { recursive: true });
        const flush = async () => {
          try {
            const snapshot = await getDiagnostics(session, { severity: opts.errorsOnly ? "error" : "all" });
            writeFileSync(out, `${snapshot.text}\n`);
          } catch {
            /* session mid-refresh — the next push catches up */
          }
        };
        let timer: NodeJS.Timeout | undefined;
        s.unsubscribe = session.onDiagnosticsRefresh(() => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void flush(), 150);
        });
        s.status = "running";
        await flush(); // initial snapshot
      } catch (e) {
        s.status = "error";
        s.error = e instanceof Error ? e.message : String(e);
      }
    })();
    return { running: true, state: "starting", out, message: `ts-error mirror starting → ${out} (live session; poll status)` };
  }

  if (action === "stop") {
    const s = state;
    state = null;
    if (!s) return { running: false, out, message: "ts-error mirror off (nothing running)" };
    s.cancelled = true;
    s.unsubscribe?.();
    return { running: false, out: s.out, message: `ts-error mirror off (was → ${s.out})` };
  }

  // status
  const s = state;
  if (!s) return { running: false, out, message: "ts-error mirror off" };
  if (s.status === "error") {
    return { running: false, state: "error", out: s.out, error: true, message: `ts-error mirror error: ${s.error}` };
  }
  let lines = 0;
  let summary = "";
  try {
    const content = readFileSync(s.out, "utf8");
    lines = content.split("\n").filter(Boolean).length;
    summary = content.split("\n").find((l) => /error|warning|diagnostic|clean/i.test(l)) ?? "";
  } catch {
    /* not written yet */
  }
  return {
    running: true,
    state: s.status,
    out: s.out,
    message:
      s.status === "starting"
        ? `ts-error mirror starting → ${s.out}`
        : `ts-error mirror on → ${s.out} · ${lines} lines${summary ? ` · ${summary.slice(0, 80)}` : ""}`,
  };
}
