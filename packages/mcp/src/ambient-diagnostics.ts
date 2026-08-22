import {
  type Diagnostic,
  type DocumentDiagnosticReport,
  DocumentDiagnosticRequest,
  type Position,
  type Range,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import { containsPosition, declarationChainAtPosition, renderDocument } from "@type-atlas/core";
import { displayPath, slash } from "@type-atlas/atlascii";
import type { VolarWorkspace } from "@type-atlas/core";
import { enclosingDeclaration } from "./reference-groups.ts";

export type DiagnosticMode = "summary" | "verbose" | "off";

/**
 * TypeScript writes machine-absolute paths into message text —
 * `import("/home/user/repo/packages/money/src/money").Money` — the one place
 * the workspace-relative rule of every response was still broken. Relativized
 * here, at the presentation boundary, for every surface that renders a
 * diagnostic's message.
 */
export const workspaceRelativeMessage = (message: string, workspaceRoot: string): string =>
  message.replaceAll(`${slash(workspaceRoot).replace(/\/$/u, "")}/`, "");

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
  readonly cost?: { readonly elapsedMs: number; readonly reused: boolean };
}): Promise<string | undefined> => {
  const entries = reported(input.report);
  if (entries.length === 0) return undefined;
  const file = displayPath(input.uri, input.workspaceRoot);
  const here = focused(entries, input.focus);
  const counted = here.length > 0 ? here : entries;
  const rendered = await renderDocument({
    document: "diagnostic-context.mdoc",
    variables: {
      verbose: input.mode === "verbose",
      // One file, so one group: the path leads it once rather than every row.
      groups: [
        {
          file,
          problems: entries.map((entry) => ({
            ...entry,
            message: workspaceRelativeMessage(entry.message, input.workspaceRoot),
          })),
        },
      ],
      // A positionless request may not claim a position, however many of the
      // file's rows happen to sit where no focus was given.
      here: input.focus !== undefined && here.length > 0,
      // Two words, two counts: an unused-import hint is not a problem, and a
      // summary that counted it as one contradicted the whole-project check
      // that rightly ignores it.
      problems: counted.filter((entry) => (entry.severity ?? 1) <= 2).length,
      hints: counted.filter((entry) => (entry.severity ?? 1) >= 3).length,
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
    async ({ report, elapsedMs }) => {
      // Every located row names what stands there. A diagnostic's position
      // without its holder is a row a reader must open the file to decode —
      // the same referent every reference row already carries.
      // Cost, measured cold-first 2026-08-19 (fresh server per measurement,
      // so no cache obscures it): 828ms cold for a 1-row file — dominated by
      // the project build and the report, not the chain — and 17ms on the
      // warm repeat, which re-runs the chain every call against the cached
      // report. The multiplying worst case is rows across distinct files on
      // the page-capped tool path, each first-touch outline ~25ms: ~+2.5s at
      // the 100-row cap, on top of a whole-project check that itself costs
      // tens of seconds at that scale. If that ever bites, the lever is one
      // outline per file instead of one chain request per row.
      const named = await Promise.all(
        reported(report).map(async (entry) => {
          const chain = await declarationChainAtPosition({
            workspace,
            uri: textDocument.uri,
            position: entry.range.start,
          }).catch(() => []);
          return { ...entry, within: enclosingDeclaration(chain, entry.range)?.name };
        }),
      );
      return formatDiagnosticMode({
        uri: textDocument.uri,
        report: report && "items" in report ? { ...report, items: named } : report,
        workspaceRoot,
        mode,
        focus,
        cost: { elapsedMs, reused: held !== undefined },
      });
    },
    () => undefined,
  );
}
