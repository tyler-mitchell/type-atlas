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

export interface DiagnosticSnapshot {
  text: string;
  totalCount: number;
  totalErrorCount: number;
  totalWarningCount: number;
  newCount: number;
  baselineCount: number;
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

  if (args.summary) {
    return {
      text: formatSummary(diagnostics, counts),
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

function formatSummary(
  diagnostics: FormattedDiagnostic[],
  counts: Omit<DiagnosticSnapshot, "text">,
): string {
  if (diagnostics.length === 0) return "No diagnostics.";

  const byFile = new Map<
    string,
    { errors: number; warnings: number; new: number; baseline: number }
  >();
  for (const diagnostic of diagnostics) {
    const entry = byFile.get(diagnostic.file) ?? {
      errors: 0,
      warnings: 0,
      new: 0,
      baseline: 0,
    };
    if (diagnostic.severity === "error") entry.errors++;
    else entry.warnings++;
    if (diagnostic.scope === "new") entry.new++;
    else entry.baseline++;
    byFile.set(diagnostic.file, entry);
  }

  const lines: string[] = [];
  lines.push(
    `${counts.totalCount} diagnostics (${counts.totalErrorCount} errors, ${counts.totalWarningCount} warnings | ${counts.newCount} new, ${counts.baselineCount} baseline)`,
  );
  lines.push("");

  for (const [file, counts] of byFile) {
    const parts: string[] = [];
    if (counts.errors) parts.push(`${counts.errors} errors`);
    if (counts.warnings) parts.push(`${counts.warnings} warnings`);
    const scopeParts: string[] = [];
    if (counts.new) scopeParts.push(`${counts.new} new`);
    if (counts.baseline) scopeParts.push(`${counts.baseline} baseline`);
    lines.push(`  ${file}: ${parts.join(", ")} (${scopeParts.join(", ")})`);
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
