import {
  DocumentDiagnosticRequest,
  type Position,
  type Range,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import { formatDiagnosticContext } from "./plain-text.ts";
import type { VolarWorkspace } from "./volar-workspace.ts";

export function requestDiagnosticContext(
  workspace: VolarWorkspace,
  textDocument: TextDocumentIdentifier,
  workspaceRoot: string,
  includeDiagnostics: boolean,
  signal: AbortSignal,
  focus?: Position | Range,
): Promise<string | undefined> {
  if (!includeDiagnostics) {
    return Promise.resolve(undefined);
  }

  return workspace.sendRequest(
    DocumentDiagnosticRequest.type,
    { textDocument },
    signal,
  ).then(
    (report) =>
      formatDiagnosticContext(
        textDocument.uri,
        report,
        workspaceRoot,
        focus,
      ),
    () => undefined,
  );
}
