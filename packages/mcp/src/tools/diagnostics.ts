/** get_diagnostics — returns errors/warnings for a file or the whole project. */

import * as path from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import {
  formatDiagnostic,
  diagnosticsToXml,
  type FormattedDiagnostic,
} from "../format.js";

const PROJECT_DIAGNOSTIC_CONCURRENCY = 24;
const MAX_PROJECT_DIAGNOSTIC_FILES = 250;

async function collectFileDiagnostics(
  session: DiagnosticsSession,
  absPath: string,
): Promise<FormattedDiagnostic[]> {
  const relPath = path.relative(session.rootDir, absPath);
  const rawDiags = await session.getFileDiagnostics(absPath);
  return rawDiags.map((diagnostic) => formatDiagnostic(diagnostic, relPath));
}

async function collectProjectDiagnostics(
  session: DiagnosticsSession,
): Promise<FormattedDiagnostic[]> {
  const workspaceDiagnostics = await session.getWorkspaceDiagnostics();

  if (workspaceDiagnostics !== null) {
    return workspaceDiagnostics.flatMap(({ filePath, diagnostics }) =>
      diagnostics.map((diagnostic) =>
        formatDiagnostic(diagnostic, path.relative(session.rootDir, filePath)),
      ),
    );
  }

  const fileNames = await session.getProjectFileNames();
  const diagnostics: FormattedDiagnostic[] = [];

  for (let start = 0; start < fileNames.length; start += PROJECT_DIAGNOSTIC_CONCURRENCY) {
    const batch = fileNames.slice(start, start + PROJECT_DIAGNOSTIC_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((fileName) => collectFileDiagnostics(session, fileName)),
    );
    diagnostics.push(...batchResults.flat());
  }

  return diagnostics;
}

export interface DiagnosticArgs {
  file?: string;
  severity?: "error" | "warning" | "all";
  summary?: boolean;
}

export interface DiagnosticFileSummary {
  file: string;
  totalCount: number;
  totalErrorCount: number;
  totalWarningCount: number;
  generated: boolean;
}

export interface DiagnosticSnapshot {
  text: string;
  totalCount: number;
  totalErrorCount: number;
  totalWarningCount: number;
  files?: DiagnosticFileSummary[];
  limited?: boolean;
  projectFileCount?: number;
  projectFileLimit?: number;
  error?: { code: string; message: string } | null;
}

export async function getDiagnostics(
  session: DiagnosticsSession,
  args: DiagnosticArgs,
): Promise<DiagnosticSnapshot> {
  const projectFileCount = (await session.getProjectFileNames()).length;
  if (!args.file && projectFileCount > MAX_PROJECT_DIAGNOSTIC_FILES) {
    const message = [
      "Whole-project diagnostics are disabled for large workspaces.",
      `Attached project has ${projectFileCount} files, which exceeds the fast-scan limit of ${MAX_PROJECT_DIAGNOSTIC_FILES}.`,
      "Attach a smaller subproject root to use get_diagnostics here.",
    ].join(" ");

    return {
      text: message,
      totalCount: 0,
      totalErrorCount: 0,
      totalWarningCount: 0,
      files: [],
      limited: true,
      projectFileCount,
      projectFileLimit: MAX_PROJECT_DIAGNOSTIC_FILES,
      error: {
        code: "PROJECT_TOO_LARGE",
        message,
      },
    };
  }

  let diagnostics: FormattedDiagnostic[];

  if (args.file) {
    const absPath = path.resolve(session.rootDir, args.file);
    diagnostics = await collectFileDiagnostics(session, absPath);
  } else {
    diagnostics = await collectProjectDiagnostics(session);
  }

  const severityFilter = args.severity ?? "all";
  if (severityFilter !== "all") {
    diagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.severity === severityFilter,
    );
  }

  const counts = summarizeDiagnostics(diagnostics);
  const fileSummaries = summarizeDiagnosticsByFile(diagnostics);

  if (args.summary) {
    return {
      text: formatSummary(counts, fileSummaries),
      files: fileSummaries,
      limited: false,
      error: null,
      ...counts,
    };
  }

  return {
    text: diagnosticsToXml(diagnostics),
    limited: false,
    error: null,
    ...counts,
  };
}

function summarizeDiagnostics(
  diagnostics: FormattedDiagnostic[],
): Omit<DiagnosticSnapshot, "text"> {
  const totalErrorCount = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const totalWarningCount = diagnostics.length - totalErrorCount;

  return {
    totalCount: diagnostics.length,
    totalErrorCount,
    totalWarningCount,
  };
}

const GENERATED_DIAGNOSTIC_SEGMENTS = new Set([
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "node_modules",
]);

function normalizeDiagnosticPathSegments(filePath: string): string[] {
  return filePath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

function isLikelyGeneratedDiagnosticPath(filePath: string): boolean {
  const normalizedSegments = normalizeDiagnosticPathSegments(filePath);
  if (normalizedSegments.some((segment) => GENERATED_DIAGNOSTIC_SEGMENTS.has(segment))) {
    return true;
  }

  const normalizedPath = filePath.toLowerCase();
  return /(?:^|\/)patches\/.+\/dist(?:\/|$)/.test(normalizedPath) ||
    /\.[0-9a-f]{6,}\.(?:c|m)?js$/i.test(normalizedPath);
}

function summarizeDiagnosticsByFile(
  diagnostics: FormattedDiagnostic[],
): DiagnosticFileSummary[] {
  const byFile = new Map<string, DiagnosticFileSummary>();

  for (const diagnostic of diagnostics) {
    const entry = byFile.get(diagnostic.file) ?? {
      file: diagnostic.file,
      totalCount: 0,
      totalErrorCount: 0,
      totalWarningCount: 0,
      generated: isLikelyGeneratedDiagnosticPath(diagnostic.file),
    };

    entry.totalCount += 1;
    if (diagnostic.severity === "error") {
      entry.totalErrorCount += 1;
    } else {
      entry.totalWarningCount += 1;
    }

    byFile.set(diagnostic.file, entry);
  }

  return [...byFile.values()].sort((left, right) => {
    if (left.generated !== right.generated) {
      return Number(left.generated) - Number(right.generated);
    }
    if (right.totalErrorCount !== left.totalErrorCount) {
      return right.totalErrorCount - left.totalErrorCount;
    }
    if (right.totalWarningCount !== left.totalWarningCount) {
      return right.totalWarningCount - left.totalWarningCount;
    }
    if (right.totalCount !== left.totalCount) {
      return right.totalCount - left.totalCount;
    }
    return left.file.localeCompare(right.file);
  });
}

function formatSummary(
  counts: Omit<DiagnosticSnapshot, "text">,
  fileSummaries: DiagnosticFileSummary[],
): string {
  if (fileSummaries.length === 0) return "No diagnostics.";

  const lines: string[] = [];
  lines.push(
    `${counts.totalCount} diagnostics (${counts.totalErrorCount} errors, ${counts.totalWarningCount} warnings)`,
  );
  lines.push("");

  for (const summary of fileSummaries) {
    const parts: string[] = [];
    if (summary.totalErrorCount) parts.push(`${summary.totalErrorCount} errors`);
    if (summary.totalWarningCount) parts.push(`${summary.totalWarningCount} warnings`);
    const generatedSuffix = summary.generated ? " [generated]" : "";
    lines.push(
      `  ${summary.file}${generatedSuffix}: ${parts.join(", ")}`,
    );
  }

  return lines.join("\n");
}
