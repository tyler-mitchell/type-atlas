import * as path from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import { WorkspaceChange, type FormattingOptions, type WorkspaceEdit } from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";

export const getFormattingEdit = async (
  session: DiagnosticsSession,
  file: string,
  options: FormattingOptions,
  signal?: AbortSignal,
): Promise<WorkspaceEdit | null> => {
  const absolute = path.resolve(session.rootDir, file);
  const edits = await session.getFileFormattingEdits(absolute, options, signal);
  if (edits.length === 0) return null;

  const change = new WorkspaceChange();
  const document = change.getTextEditChange({
    uri: URI.file(absolute).toString(),
    version: session.getFileVersion(absolute),
  });
  for (const edit of edits) document.add(edit);
  return change.edit;
};
