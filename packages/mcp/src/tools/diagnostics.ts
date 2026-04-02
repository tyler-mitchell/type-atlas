/**
 * get_diagnostics — returns errors/warnings for a file or the whole project.
 * snapshot_baseline — captures current diagnostic state for diffing.
 */

import * as path from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import {
  formatDiagnostic,
  diagnosticsToXml,
  type FormattedDiagnostic,
} from "../format.js";
import {
  createBaseline,
  classifyDiagnostic,
  type BaselineSnapshot,
} from "../baseline.js";

const baselines = new Map<string, BaselineSnapshot>();

async function collectFileDiagnostics(
  session: DiagnosticsSession,
  absPath: string,
): Promise<FormattedDiagnostic[]> {
  const relPath = path.relative(session.rootDir, absPath);
  const baseline = baselines.get(session.rootDir) ?? null;
  const rawDiags = await session.getFileDiagnostics(absPath);
  return rawDiags.map((diagnostic) => {
    const formatted = formatDiagnostic(diagnostic, relPath, "new");
    formatted.scope = classifyDiagnostic(formatted, baseline);
    return formatted;
  });
}

export interface DiagnosticArgs {
  file?: string;
  scope?: "new" | "baseline" | "all";
  severity?: "error" | "warning" | "all";
  summary?: boolean;
}

export interface DiagnosticFileSummary {
  file: string;
  totalCount: number;
  totalErrorCount: number;
  totalWarningCount: number;
  newCount: number;
  baselineCount: number;
  generated: boolean;
}

export interface DiagnosticSnapshot {
  text: string;
  totalCount: number;
  totalErrorCount: number;
  totalWarningCount: number;
  newCount: number;
  baselineCount: number;
  files?: DiagnosticFileSummary[];
}

export async function getDiagnostics(
  session: DiagnosticsSession,
  args: DiagnosticArgs,
): Promise<DiagnosticSnapshot> {
  let diagnostics: FormattedDiagnostic[];

  if (args.file) {
    const absPath = path.resolve(session.rootDir, args.file);
    diagnostics = await collectFileDiagnostics(session, absPath);
  } else {
    diagnostics = [];
    for (const fileName of await session.getProjectFileNames()) {
      const fileDiags = await collectFileDiagnostics(session, fileName);
      diagnostics.push(...fileDiags);
    }
  }

  const scopeFilter = args.scope ?? "all";
  if (scopeFilter !== "all") {
    diagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.scope === scopeFilter,
    );
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
      ...counts,
    };
  }

  return {
    text: diagnosticsToXml(diagnostics),
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
  const newCount = diagnostics.filter(
    (diagnostic) => diagnostic.scope === "new",
  ).length;
  const baselineCount = diagnostics.filter(
    (diagnostic) => diagnostic.scope === "baseline",
  ).length;

  return {
    totalCount: diagnostics.length,
    totalErrorCount,
    totalWarningCount,
    newCount,
    baselineCount,
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
      newCount: 0,
      baselineCount: 0,
      generated: isLikelyGeneratedDiagnosticPath(diagnostic.file),
    };

    entry.totalCount += 1;
    if (diagnostic.severity === "error") {
      entry.totalErrorCount += 1;
    } else {
      entry.totalWarningCount += 1;
    }
    if (diagnostic.scope === "new") {
      entry.newCount += 1;
    } else {
      entry.baselineCount += 1;
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
    `${counts.totalCount} diagnostics (${counts.totalErrorCount} errors, ${counts.totalWarningCount} warnings | ${counts.newCount} new, ${counts.baselineCount} baseline)`,
  );
  lines.push("");

  for (const summary of fileSummaries) {
    const parts: string[] = [];
    if (summary.totalErrorCount) parts.push(`${summary.totalErrorCount} errors`);
    if (summary.totalWarningCount) parts.push(`${summary.totalWarningCount} warnings`);
    const scopeParts: string[] = [];
    if (summary.newCount) scopeParts.push(`${summary.newCount} new`);
    if (summary.baselineCount) scopeParts.push(`${summary.baselineCount} baseline`);
    const generatedSuffix = summary.generated ? " [generated]" : "";
    lines.push(
      `  ${summary.file}${generatedSuffix}: ${parts.join(", ")} (${scopeParts.join(", ")})`,
    );
  }

  return lines.join("\n");
}

export async function snapshotBaseline(
  session: DiagnosticsSession,
): Promise<string> {
  const diagnostics: FormattedDiagnostic[] = [];
  for (const fileName of await session.getProjectFileNames()) {
    const relPath = path.relative(session.rootDir, fileName);
    const rawDiags = await session.getFileDiagnostics(fileName);
    for (const diagnostic of rawDiags) {
      diagnostics.push(formatDiagnostic(diagnostic, relPath, "baseline"));
    }
  }

  const baseline = createBaseline(diagnostics);
  baselines.set(session.rootDir, baseline);
  return `Baseline captured: ${baseline.fingerprints.size} diagnostics at ${new Date(
    baseline.createdAt,
  ).toISOString()}`;
}

export function getBaseline(rootDir?: string): BaselineSnapshot | null {
  if (rootDir) {
    return baselines.get(path.resolve(rootDir)) ?? null;
  }
  return baselines.values().next().value ?? null;
}
