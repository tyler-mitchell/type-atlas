import {
  type Diagnostic,
  type DocumentDiagnosticReport,
  DocumentDiagnosticRequest,
  type Position,
  type Range,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import { containsPosition, renderDocument } from "@type-atlas/core";
import { displayPath } from "atlascii";
import type { VolarWorkspace } from "@type-atlas/core";

export type DiagnosticMode = "summary" | "verbose" | "off";

const reported = (report: DocumentDiagnosticReport | null | undefined): readonly Diagnostic[] =>
  report && "items" in report ? report.items : [];

const focused = (entries: readonly Diagnostic[], focus: Position | Range | undefined) => {
  if (!focus) return entries;
  const position = "line" in focus ? focus : focus.start;
  return entries.filter((entry) => containsPosition(entry.range, position));
};

export const formatDiagnosticMode = async (input: {
  readonly uri: string;
  readonly report: DocumentDiagnosticReport | null | undefined;
  readonly workspaceRoot: string;
  readonly mode: DiagnosticMode;
  readonly focus?: Position | Range;
  readonly cost?: string;
}): Promise<string | undefined> => {
  const entries = reported(input.report);
  if (entries.length === 0) return undefined;
  const file = displayPath(input.uri, input.workspaceRoot);
  const here = focused(entries, input.focus);
  const rendered = await renderDocument({
    document: "diagnostic-context.mdoc",
    variables: {
      verbose: input.mode === "verbose",
      // One file, so one group: the path leads it once rather than every row.
      groups: [{ file, problems: entries }],
      here: here.length > 0,
      count: here.length || entries.length,
      file,
      cost: input.cost,
    },
  });
  return rendered.text || undefined;
};

type CachedReport = {
  readonly report: DocumentDiagnosticReport | null | undefined;
  readonly elapsedMs: number;
};

const reports = new WeakMap<VolarWorkspace, Map<string, Promise<CachedReport>>>();

const checked = (workspace: VolarWorkspace): Map<string, Promise<CachedReport>> => {
  const held = reports.get(workspace);
  if (held) return held;
  const fresh = new Map<string, Promise<CachedReport>>();
  reports.set(workspace, fresh);
  workspace.observeChanges(() => fresh.clear());
  return fresh;
};

export function requestDiagnosticContext(
  workspace: VolarWorkspace,
  textDocument: TextDocumentIdentifier,
  workspaceRoot: string,
  includeDiagnostics: DiagnosticMode | undefined,
  signal: AbortSignal,
  focus?: Position | Range,
): Promise<string | undefined> {
  const mode = includeDiagnostics ?? "summary";
  if (mode === "off") return Promise.resolve(undefined);

  const cache = checked(workspace);
  const held = cache.get(textDocument.uri);
  const pending =
    held ??
    (() => {
      const started = performance.now();
      const request = workspace
        .sendRequest(DocumentDiagnosticRequest.type, { textDocument }, signal)
        .then((report) => ({ report, elapsedMs: Math.round(performance.now() - started) }));
      cache.set(textDocument.uri, request);
      void request.catch(() => cache.delete(textDocument.uri));
      return request;
    })();
  return pending.then(
    ({ report, elapsedMs }) =>
      formatDiagnosticMode({
        uri: textDocument.uri,
        report,
        workspaceRoot,
        mode,
        focus,
        cost: held ? `reused, first cost ${elapsedMs}ms` : `${elapsedMs}ms`,
      }),
    () => undefined,
  );
}
