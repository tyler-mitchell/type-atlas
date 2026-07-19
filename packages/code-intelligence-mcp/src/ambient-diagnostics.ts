import {
  DocumentDiagnosticRequest,
  type Position,
  type Range,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import { formatDiagnosticContext } from "@featuretype/code-intelligence/text";
import type { VolarWorkspace } from "@featuretype/code-intelligence";

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
