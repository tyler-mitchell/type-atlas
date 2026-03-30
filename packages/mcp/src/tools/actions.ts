/**
 * get_code_actions — compiler-known quick fixes and refactors.
 */

import { URI } from "vscode-uri";
import * as path from "node:path";
import type * as vscode from "vscode-languageserver-protocol";
import type { VolarHost } from "../volar-host.js";
import { explainFailure } from "../failure.js";

export async function getCodeActions(
  host: VolarHost,
  args: { file: string; startLine: number; startCol: number; endLine: number; endCol: number },
): Promise<string> {
  const absPath = path.resolve(host.rootDir, args.file);
  const uri = URI.file(absPath);
  const range: vscode.Range = {
    start: { line: args.startLine - 1, character: args.startCol - 1 },
    end: { line: args.endLine - 1, character: args.endCol - 1 },
  };

  // Get diagnostics for the range to provide context
  const allDiags = await host.languageService.getDiagnostics(uri);
  const rangeDiags = allDiags.filter((d) => rangesOverlap(d.range, range));

  const context: vscode.CodeActionContext = {
    diagnostics: rangeDiags,
  };

  const actions = await host.languageService.getCodeActions(uri, range, context);
  if (!actions || actions.length === 0) {
    return explainFailure("get_code_actions", args.file, host, {
      position: `${args.startLine}:${args.startCol}-${args.endLine}:${args.endCol}`,
      hint: "No quick fixes or refactors available for this range. If there are diagnostics, try targeting the exact error line.",
    });
  }

  const results = actions.map((action) => {
    const parts = [`[${action.kind ?? "quickfix"}] ${action.title}`];
    if (action.edit?.changes) {
      for (const [changeUri, edits] of Object.entries(action.edit.changes)) {
        const changePath = path.relative(
          host.rootDir,
          URI.parse(changeUri).fsPath,
        );
        for (const edit of edits) {
          parts.push(
            `  ${changePath}:${edit.range.start.line + 1} → ${edit.newText.slice(0, 100)}${edit.newText.length > 100 ? "..." : ""}`,
          );
        }
      }
    }
    return parts.join("\n");
  });

  return results.join("\n\n");
}

function rangesOverlap(a: vscode.Range, b: vscode.Range): boolean {
  if (a.end.line < b.start.line) return false;
  if (a.start.line > b.end.line) return false;
  if (a.end.line === b.start.line && a.end.character < b.start.character)
    return false;
  if (a.start.line === b.end.line && a.start.character > b.end.character)
    return false;
  return true;
}
