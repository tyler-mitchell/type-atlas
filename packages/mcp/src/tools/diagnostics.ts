/**
 * get_diagnostics — returns errors/warnings for a file or the whole project.
 * snapshot_baseline — captures current diagnostic state for diffing.
 */

import { URI } from "vscode-uri";
import * as path from "node:path";
import type { VolarHost } from "../volar-host.js";
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

let baseline: BaselineSnapshot | null = null;

async function collectFileDiagnostics(
  host: VolarHost,
  absPath: string,
): Promise<FormattedDiagnostic[]> {
  const uri = URI.file(absPath);
  const relPath = path.relative(host.rootDir, absPath);
  const rawDiags = await host.languageService.getDiagnostics(uri);
  return rawDiags.map((d) => {
    const formatted = formatDiagnostic(d, relPath, "new");
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

export async function getDiagnostics(
  host: VolarHost,
  args: DiagnosticArgs,
): Promise<string> {
  let diagnostics: FormattedDiagnostic[];

  if (args.file) {
    const absPath = path.resolve(host.rootDir, args.file);
    diagnostics = await collectFileDiagnostics(host, absPath);
  } else {
    diagnostics = [];
    for (const fileName of host.getProjectFileNames()) {
      const fileDiags = await collectFileDiagnostics(host, fileName);
      diagnostics.push(...fileDiags);
    }
  }

  // Filter by scope
  const scopeFilter = args.scope ?? "all";
  if (scopeFilter !== "all") {
    diagnostics = diagnostics.filter((d) => d.scope === scopeFilter);
  }

  // Filter by severity
  const severityFilter = args.severity ?? "all";
  if (severityFilter !== "all") {
    diagnostics = diagnostics.filter((d) => d.severity === severityFilter);
  }

  // Summary mode: grouped counts instead of full XML
  if (args.summary) {
    return formatSummary(diagnostics);
  }

  return diagnosticsToXml(diagnostics);
}

function formatSummary(diagnostics: FormattedDiagnostic[]): string {
  if (diagnostics.length === 0) return "No diagnostics.";

  const byFile = new Map<string, { errors: number; warnings: number; new: number; baseline: number }>();
  for (const d of diagnostics) {
    const entry = byFile.get(d.file) ?? { errors: 0, warnings: 0, new: 0, baseline: 0 };
    if (d.severity === "error") entry.errors++;
    else entry.warnings++;
    if (d.scope === "new") entry.new++;
    else entry.baseline++;
    byFile.set(d.file, entry);
  }

  const totalNew = diagnostics.filter((d) => d.scope === "new").length;
  const totalBaseline = diagnostics.filter((d) => d.scope === "baseline").length;
  const totalErrors = diagnostics.filter((d) => d.severity === "error").length;
  const totalWarnings = diagnostics.length - totalErrors;

  const lines: string[] = [];
  lines.push(`${diagnostics.length} diagnostics (${totalErrors} errors, ${totalWarnings} warnings | ${totalNew} new, ${totalBaseline} baseline)`);
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
  host: VolarHost,
): Promise<string> {
  const diagnostics: FormattedDiagnostic[] = [];
  for (const fileName of host.getProjectFileNames()) {
    const uri = URI.file(fileName);
    const relPath = path.relative(host.rootDir, fileName);
    const rawDiags = await host.languageService.getDiagnostics(uri);
    for (const d of rawDiags) {
      diagnostics.push(formatDiagnostic(d, relPath, "baseline"));
    }
  }

  baseline = createBaseline(diagnostics);
  return `Baseline captured: ${baseline.fingerprints.size} diagnostics at ${new Date(baseline.createdAt).toISOString()}`;
}

export function getBaseline(): BaselineSnapshot | null {
  return baseline;
}
