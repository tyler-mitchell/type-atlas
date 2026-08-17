import {
  type DocumentDiagnosticReport,
  DocumentDiagnosticRequest,
  type Position,
  type Range,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import { formatDiagnosticContext, formatDiagnostics } from "@type-atlas/core/text";
import type { VolarWorkspace } from "@type-atlas/core";

export type DiagnosticMode = "summary" | "verbose" | "off";

export const formatDiagnosticMode = (
  uri: string,
  report: DocumentDiagnosticReport | null | undefined,
  workspaceRoot: string,
  mode: DiagnosticMode,
  focus?: Position | Range,
): string | undefined =>
  mode === "verbose"
    ? formatDiagnostics(uri, report, workspaceRoot) || undefined
    : formatDiagnosticContext(uri, report, workspaceRoot, focus);

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

  return workspace.sendRequest(DocumentDiagnosticRequest.type, { textDocument }, signal).then(
    (report) => formatDiagnosticMode(textDocument.uri, report, workspaceRoot, mode, focus),
    () => undefined,
  );
}
