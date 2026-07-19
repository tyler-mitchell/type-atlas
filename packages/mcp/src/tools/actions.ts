/**
 * get_code_actions — compiler-known quick fixes and refactors.
 */

import type { DiagnosticsSession } from "@featuretype/language-server";
import type * as vscode from "vscode-languageserver-protocol";
import { explainFailure } from "../failure.js";
import { collectWorkspaceTextEdits } from "./workspace-edits.js";
import * as path from "node:path";

export interface CodeActionResult {
  text: string;
  actions: Array<vscode.CodeAction | vscode.Command>;
}

export async function getCodeActions(
  session: DiagnosticsSession,
  args: { file: string; startLine: number; startCol: number; endLine: number; endCol: number },
  signal?: AbortSignal,
): Promise<CodeActionResult> {
  const absPath = path.resolve(session.rootDir, args.file);
  const range: vscode.Range = {
    start: { line: args.startLine - 1, character: args.startCol - 1 },
    end: { line: args.endLine - 1, character: args.endCol - 1 },
  };

  // Get diagnostics for the range to provide context
  const allDiags = await session.getFileDiagnostics(absPath);
  const rangeDiags = allDiags.filter((d) => rangesOverlap(d.range, range));

  const actions = await session.getFileCodeActions(absPath, range, rangeDiags, signal);
  if (!actions || actions.length === 0) {
    return {
      text: await explainFailure("get_code_actions", args.file, session, {
        position: `${args.startLine}:${args.startCol}-${args.endLine}:${args.endCol}`,
        hint: "No quick fixes or refactors available for this range. If there are diagnostics, try targeting the exact error line.",
      }),
      actions: [],
    };
  }

  const results = actions.map((action) => {
    const parts = [`[${"kind" in action ? action.kind ?? "quickfix" : "command"}] ${action.title}`];
    if ("data" in action && action.data != null) parts.push("  (resolve on selection)");
    if ("edit" in action) {
      for (const edit of collectWorkspaceTextEdits(session.rootDir, action.edit)) {
        parts.push(
          `  ${edit.file}:${edit.line} → ${edit.newText.slice(0, 100)}${edit.newText.length > 100 ? "..." : ""}`,
        );
      }
    }
    return parts.join("\n");
  });

  return {
    text: results.join("\n\n"),
    actions,
  };
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
