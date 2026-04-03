/**
 * find_errors_and_fixes — errors paired with their available code actions.
 *
 * Runs diagnostics and fetches code actions for each error in a single pass,
 * avoiding the multi-round-trip pattern of calling get_diagnostics then
 * get_code_actions per error.
 */

import type { DiagnosticsSession } from "@featuretype/language-server";
import * as path from "node:path";
import { TextDocumentEdit } from "vscode-languageserver-protocol";
import type * as vscode from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import { formatDiagnostic, type FormattedDiagnostic } from "../format.js";

const PROJECT_DIAGNOSTIC_CONCURRENCY = 24;

export interface DiagnosticFix {
  title: string;
  kind: string;
  edits: Array<{
    file: string;
    line: number;
    newText: string;
  }>;
}

export interface DiagnosticWithFixes {
  file: string;
  line: number;
  col: number;
  severity: "error" | "warning" | "info" | "hint";
  code: string;
  message: string;
  fixes: DiagnosticFix[];
}

export interface ErrorsAndFixesSnapshot {
  text: string;
  totalErrorCount: number;
  totalWarningCount: number;
  totalCount: number;
  items: DiagnosticWithFixes[];
  limited?: boolean;
  projectFileCount?: number;
  projectFileLimit?: number;
}

const MAX_PROJECT_DIAGNOSTIC_FILES = 250;

async function fetchActionsForDiagnostic(
  session: DiagnosticsSession,
  absPath: string,
  diagnostic: FormattedDiagnostic,
  rawDiags: vscode.Diagnostic[],
): Promise<DiagnosticFix[]> {
  const range: vscode.Range = {
    start: {
      line: diagnostic.line - 1,
      character: diagnostic.col - 1,
    },
    end: {
      line: (diagnostic.endLine ?? diagnostic.line) - 1,
      character: (diagnostic.endCol ?? diagnostic.col) - 1,
    },
  };

  // Only pass diagnostics that overlap this range — mirrors what getCodeActions does
  // internally, but we already have rawDiags so we avoid a second getFileDiagnostics call.
  const overlapping = rawDiags.filter((d) => rangesOverlap(d.range, range));

  let actions: vscode.CodeAction[] | null = null;
  try {
    actions = await session.getFileCodeActions(absPath, range, overlapping);
  } catch {
    return [];
  }

  if (!actions || actions.length === 0) return [];

  return actions.map((action): DiagnosticFix => {
    const kind = "kind" in action ? (action.kind ?? "quickfix") : "command";
    const edits: DiagnosticFix["edits"] = [];

    if ("edit" in action && action.edit) {
      const workspaceEdit = action.edit;

      // Handle legacy changes map
      if (workspaceEdit.changes) {
        for (const [changeUri, textEdits] of Object.entries(workspaceEdit.changes)) {
          const changePath = path.relative(session.rootDir, URI.parse(changeUri).fsPath);
          for (const edit of textEdits) {
            edits.push({
              file: changePath,
              line: edit.range.start.line + 1,
              newText: edit.newText,
            });
          }
        }
      }

      // Handle documentChanges (TextDocumentEdit + file renames) — Volar uses this
      for (const change of workspaceEdit.documentChanges ?? []) {
        if (TextDocumentEdit.is(change)) {
          const changePath = path.relative(session.rootDir, URI.parse(change.textDocument.uri).fsPath);
          for (const edit of change.edits) {
            if ("newText" in edit) {
              edits.push({
                file: changePath,
                line: edit.range.start.line + 1,
                newText: edit.newText,
              });
            }
          }
        }
      }
    }

    return { title: action.title, kind, edits };
  });
}

async function collectForFile(
  session: DiagnosticsSession,
  absPath: string,
  severityFilter: "error" | "warning" | "all",
): Promise<DiagnosticWithFixes[]> {
  const relPath = path.relative(session.rootDir, absPath);
  const rawDiags = await session.getFileDiagnostics(absPath);

  if (rawDiags.length === 0) return [];

  const formatted = rawDiags.map((d) => formatDiagnostic(d, relPath));
  const filtered =
    severityFilter === "all"
      ? formatted
      : formatted.filter((d) => d.severity === severityFilter);

  return Promise.all(
    filtered.map(async (diag): Promise<DiagnosticWithFixes> => {
      const fixes = await fetchActionsForDiagnostic(session, absPath, diag, rawDiags);
      return {
        file: diag.file,
        line: diag.line,
        col: diag.col,
        severity: diag.severity,
        code: diag.code,
        message: diag.message,
        fixes,
      };
    }),
  );
}

function formatOutput(items: DiagnosticWithFixes[]): string {
  if (items.length === 0) return "No diagnostics found.";

  const lines: string[] = [];
  let currentFile = "";

  for (const item of items) {
    if (item.file !== currentFile) {
      currentFile = item.file;
      lines.push(`\n${currentFile}`);
    }

    lines.push(`  [${item.severity}] ${item.line}:${item.col}  ${item.code}  ${item.message}`);

    if (item.fixes.length === 0) {
      lines.push(`    (no fixes available)`);
    } else {
      for (const fix of item.fixes) {
        lines.push(`    → ${fix.title}`);
        for (const edit of fix.edits) {
          const preview = edit.newText.slice(0, 80).replace(/\n/g, "↵");
          lines.push(`      ${edit.file}:${edit.line}  ${preview}${edit.newText.length > 80 ? "…" : ""}`);
        }
      }
    }
  }

  return lines.join("\n").trim();
}

export interface ErrorsAndFixesArgs {
  file?: string;
  severity?: "error" | "warning" | "all";
}

export async function getErrorsAndFixes(
  session: DiagnosticsSession,
  args: ErrorsAndFixesArgs,
): Promise<ErrorsAndFixesSnapshot> {
  const severityFilter = args.severity ?? "error";

  // For single-file queries the project size is irrelevant — we only touch one file.
  if (!args.file) {
    const projectFileCount = (await session.getProjectFileNames()).length;
    if (projectFileCount > MAX_PROJECT_DIAGNOSTIC_FILES) {
      const message = [
        "Whole-project error scan is disabled for large workspaces.",
        `Attached project has ${projectFileCount} files, which exceeds the limit of ${MAX_PROJECT_DIAGNOSTIC_FILES}.`,
        "Pass a specific file path, or attach a smaller subproject root.",
      ].join(" ");
      return {
        text: message,
        totalCount: 0,
        totalErrorCount: 0,
        totalWarningCount: 0,
        items: [],
        limited: true,
        projectFileCount,
        projectFileLimit: MAX_PROJECT_DIAGNOSTIC_FILES,
      };
    }
  }

  let items: DiagnosticWithFixes[];

  if (args.file) {
    const absPath = path.resolve(session.rootDir, args.file);
    items = await collectForFile(session, absPath, severityFilter);
  } else {
    // Try workspace diagnostics first (fast path when Volar supports it).
    const workspaceDiagnostics = await session.getWorkspaceDiagnostics();

    if (workspaceDiagnostics !== null) {
      // We have all raw diagnostics; fetch actions per-diagnostic in batched concurrency.
      const allFormatted = workspaceDiagnostics.flatMap(({ filePath, diagnostics }) => ({
        absPath: filePath,
        relPath: path.relative(session.rootDir, filePath),
        rawDiags: diagnostics,
        formatted: diagnostics.map((d) =>
          formatDiagnostic(d, path.relative(session.rootDir, filePath)),
        ),
      }));

      const filtered = allFormatted.map((entry) => ({
        ...entry,
        formatted:
          severityFilter === "all"
            ? entry.formatted
            : entry.formatted.filter((d) => d.severity === severityFilter),
      })).filter((entry) => entry.formatted.length > 0);

      items = (
        await Promise.all(
          filtered.flatMap((entry) =>
            entry.formatted.map(async (diag): Promise<DiagnosticWithFixes> => {
              const fixes = await fetchActionsForDiagnostic(
                session,
                entry.absPath,
                diag,
                entry.rawDiags,
              );
              return {
                file: diag.file,
                line: diag.line,
                col: diag.col,
                severity: diag.severity,
                code: diag.code,
                message: diag.message,
                fixes,
              };
            }),
          ),
        )
      );
    } else {
      // Slow path: batched per-file, same concurrency as get_diagnostics.
      const fileNames = await session.getProjectFileNames();
      items = [];

      for (
        let start = 0;
        start < fileNames.length;
        start += PROJECT_DIAGNOSTIC_CONCURRENCY
      ) {
        const batch = fileNames.slice(start, start + PROJECT_DIAGNOSTIC_CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map((fileName) => collectForFile(session, fileName, severityFilter)),
        );
        items.push(...batchResults.flat());
      }
    }
  }

  // Sort: errors before warnings, then by file then line.
  items.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "error" ? -1 : 1;
    }
    const fileCmp = a.file.localeCompare(b.file);
    return fileCmp !== 0 ? fileCmp : a.line - b.line;
  });

  const totalErrorCount = items.filter((i) => i.severity === "error").length;
  const totalWarningCount = items.filter((i) => i.severity === "warning").length;

  return {
    text: formatOutput(items),
    totalCount: items.length,
    totalErrorCount,
    totalWarningCount,
    items,
    limited: false,
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
