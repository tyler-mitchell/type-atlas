/**
 * find_errors_and_fixes — errors paired with their available code actions.
 *
 * Runs diagnostics and fetches code actions for each error in a single pass,
 * avoiding the multi-round-trip pattern of calling get_diagnostics then
 * get_code_actions per error.
 */

import type { DiagnosticsSession } from "@featuretype/language-server";
import * as path from "node:path";
import * as vscode from "vscode-languageserver-protocol";
import { formatDiagnostic, type FormattedDiagnostic } from "../format.js";
import { collectWorkspaceTextEdits } from "./workspace-edits.js";

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

function isQuickFixKind(kind: string): boolean {
  return kind === "quickfix" || kind.startsWith("quickfix.");
}

function shouldIncludeDiagnosticAction(
  kind: string,
  includeRefactors: boolean,
): boolean {
  if (kind === "command") {
    return false;
  }

  if (isQuickFixKind(kind)) {
    return true;
  }

  if (kind.startsWith("refactor")) {
    return includeRefactors;
  }

  return false;
}

function rawDiagnosticMatchesFormatted(
  rawDiagnostic: vscode.Diagnostic,
  formattedDiagnostic: FormattedDiagnostic,
): boolean {
  const formattedRawDiagnostic = formatDiagnostic(rawDiagnostic, formattedDiagnostic.file);

  return formattedRawDiagnostic.line === formattedDiagnostic.line &&
    formattedRawDiagnostic.col === formattedDiagnostic.col &&
    formattedRawDiagnostic.endLine === formattedDiagnostic.endLine &&
    formattedRawDiagnostic.endCol === formattedDiagnostic.endCol &&
    formattedRawDiagnostic.severity === formattedDiagnostic.severity &&
    formattedRawDiagnostic.code === formattedDiagnostic.code &&
    formattedRawDiagnostic.message === formattedDiagnostic.message;
}

function actionMatchesDiagnostic(
  action: vscode.CodeAction,
  diagnostic: FormattedDiagnostic,
): boolean {
  const relatedDiagnostics = action.diagnostics ?? [];
  if (relatedDiagnostics.length === 0) {
    return isQuickFixKind(action.kind ?? "quickfix");
  }

  return relatedDiagnostics.some((relatedDiagnostic) =>
    rawDiagnosticMatchesFormatted(relatedDiagnostic, diagnostic)
  );
}

function isCodeAction(
  action: vscode.CodeAction | vscode.Command,
): action is vscode.CodeAction {
  return "kind" in action ||
    "edit" in action ||
    "diagnostics" in action ||
    "isPreferred" in action ||
    "disabled" in action ||
    "data" in action;
}

export function filterApplicableCodeActions(
  diagnostic: FormattedDiagnostic,
  actions: ReadonlyArray<vscode.CodeAction | vscode.Command>,
  options: {
    includeRefactors: boolean;
  },
): vscode.CodeAction[] {
  return actions.flatMap((action): vscode.CodeAction[] => {
    if (!isCodeAction(action)) {
      return [];
    }

    const kind = action.kind ?? "quickfix";
    if (!shouldIncludeDiagnosticAction(kind, options.includeRefactors)) {
      return [];
    }

    return actionMatchesDiagnostic(action, diagnostic) ? [action] : [];
  });
}

export function extractCodeActionFixes(
  rootDir: string,
  actions: ReadonlyArray<vscode.CodeAction | vscode.Command>,
  options: {
    includeEmptyFixes: boolean;
    includeRefactors: boolean;
  },
): DiagnosticFix[] {
  return actions.flatMap((action): DiagnosticFix[] => {
    const kind = "kind" in action ? (action.kind ?? "quickfix") : "command";
    if (!shouldIncludeDiagnosticAction(kind, options.includeRefactors)) {
      return [];
    }

    const edits =
      "edit" in action
        ? collectWorkspaceTextEdits(rootDir, action.edit)
        : [];

    if (edits.length > 0 || options.includeEmptyFixes) {
      return [{ title: action.title, kind, edits }];
    }

    return [];
  });
}

async function fetchActionsForDiagnostic(
  session: DiagnosticsSession,
  absPath: string,
  diagnostic: FormattedDiagnostic,
  rawDiags: vscode.Diagnostic[],
  options: {
    includeEmptyFixes: boolean;
    includeRefactors: boolean;
  },
): Promise<DiagnosticFix[]> {
  const matchingDiagnostics = rawDiags.filter((rawDiagnostic) =>
    rawDiagnosticMatchesFormatted(rawDiagnostic, diagnostic)
  );

  if (matchingDiagnostics.length === 0) {
    return [];
  }

  const [primaryDiagnostic] = matchingDiagnostics;

  let actions: Array<vscode.CodeAction | vscode.Command> | null = null;
  try {
    actions = await session.getFileCodeActions(
      absPath,
      primaryDiagnostic.range,
      matchingDiagnostics,
    );
  } catch {
    return [];
  }

  if (!actions || actions.length === 0) return [];

  const candidates = filterApplicableCodeActions(diagnostic, actions, {
    includeRefactors: options.includeRefactors,
  });
  const applicableActions = await Promise.all(
    candidates.map((action) => session.resolveFileCodeAction(action)),
  );

  return extractCodeActionFixes(
    session.rootDir,
    applicableActions,
    options,
  );
}

async function collectForFile(
  session: DiagnosticsSession,
  absPath: string,
  severityFilter: "error" | "warning" | "all",
  options: {
    includeEmptyFixes: boolean;
    includeRefactors: boolean;
  },
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
      const fixes = await fetchActionsForDiagnostic(
        session,
        absPath,
        diag,
        rawDiags,
        options,
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
  );
}

function summarizeFixes(fixes: readonly DiagnosticFix[]): string | null {
  if (fixes.length === 0) {
    return null;
  }

  if (fixes.length === 1) {
    return `    fix: ${fixes[0].title}`;
  }

  return `    fixes: ${fixes[0].title}; ${fixes.length - 1} more`;
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

    const fixSummary = summarizeFixes(item.fixes);
    if (fixSummary) {
      lines.push(fixSummary);
    }
  }

  return lines.join("\n").trim();
}

export interface ErrorsAndFixesArgs {
  file?: string;
  severity?: "error" | "warning" | "all";
  includeEmptyFixes?: boolean;
  includeRefactors?: boolean;
}

export async function getErrorsAndFixes(
  session: DiagnosticsSession,
  args: ErrorsAndFixesArgs,
): Promise<ErrorsAndFixesSnapshot> {
  const severityFilter = args.severity ?? "error";
  const includeEmptyFixes = args.includeEmptyFixes ?? false;
  const includeRefactors = args.includeRefactors ?? false;
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
    items = await collectForFile(
      session,
      absPath,
      severityFilter,
      { includeEmptyFixes, includeRefactors },
    );
  } else {
    // Try workspace diagnostics first (fast path when Volar supports it).
    const workspaceDiagnostics = await session.getWorkspaceDiagnostics();

    if (workspaceDiagnostics !== null) {
      // We have all raw diagnostics; fetch actions per-diagnostic in batched concurrency.
      const allFormatted = workspaceDiagnostics.map(({ filePath, diagnostics }) => ({
        absPath: filePath,
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

      items = await Promise.all(
        filtered.flatMap((entry) =>
          entry.formatted.map(async (diag): Promise<DiagnosticWithFixes> => {
            const fixes = await fetchActionsForDiagnostic(
              session,
              entry.absPath,
              diag,
              entry.rawDiags,
              { includeEmptyFixes, includeRefactors },
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
          batch.map((fileName) =>
            collectForFile(session, fileName, severityFilter, {
              includeEmptyFixes,
              includeRefactors,
            }),
          ),
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
