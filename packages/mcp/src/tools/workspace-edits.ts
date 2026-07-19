import * as path from "node:path";
import { TextDocumentEdit, type WorkspaceEdit } from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";

export interface WorkspaceTextEditPreview {
  file: string;
  line: number;
  newText: string;
}

export function collectWorkspaceTextEdits(
  rootDir: string,
  edit: WorkspaceEdit | null | undefined,
): WorkspaceTextEditPreview[] {
  if (!edit) {
    return [];
  }

  if (edit.documentChanges !== undefined) {
    return edit.documentChanges.flatMap((change) =>
      TextDocumentEdit.is(change)
        ? change.edits.flatMap((textEdit) =>
            "newText" in textEdit
              ? [
                  {
                    file: path.relative(rootDir, URI.parse(change.textDocument.uri).fsPath),
                    line: textEdit.range.start.line + 1,
                    newText: textEdit.newText,
                  },
                ]
              : [],
          )
        : [],
    );
  }

  return Object.entries(edit.changes ?? {}).flatMap(([uri, textEdits]) =>
    textEdits.map((textEdit) => ({
      file: path.relative(rootDir, URI.parse(uri).fsPath),
      line: textEdit.range.start.line + 1,
      newText: textEdit.newText,
    }))
  );
}
