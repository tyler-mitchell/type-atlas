import * as path from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import {
  getErrorsAndFixes,
  type DiagnosticWithFixes,
} from "./errors-and-fixes.js";

export interface ValidatedFileSummary {
  file: string;
  totalCount: number;
  totalErrorCount: number;
  totalWarningCount: number;
}

export interface ValidateFilesArgs {
  files: string[];
  severity?: "error" | "warning" | "all";
  includeItems?: boolean;
}

export interface ValidateFilesSnapshot {
  text: string;
  fileCount: number;
  totalCount: number;
  totalErrorCount: number;
  totalWarningCount: number;
  files: ValidatedFileSummary[];
  items?: DiagnosticWithFixes[];
}

function normalizeFiles(files: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const file of files) {
    const trimmedFile = file.trim();
    if (!trimmedFile || seen.has(trimmedFile)) {
      continue;
    }

    seen.add(trimmedFile);
    normalized.push(trimmedFile);
  }

  return normalized;
}

function formatValidationSummary(summary: ValidatedFileSummary): string {
  if (summary.totalCount === 0) {
    return `  ${summary.file}: clean`;
  }

  const parts: string[] = [];
  if (summary.totalErrorCount > 0) {
    parts.push(
      `${summary.totalErrorCount} error${summary.totalErrorCount === 1 ? "" : "s"}`,
    );
  }
  if (summary.totalWarningCount > 0) {
    parts.push(
      `${summary.totalWarningCount} warning${summary.totalWarningCount === 1 ? "" : "s"}`,
    );
  }

  return `  ${summary.file}: ${parts.join(", ")}`;
}

export async function validateFiles(
  session: DiagnosticsSession,
  args: ValidateFilesArgs,
): Promise<ValidateFilesSnapshot> {
  const files = normalizeFiles(args.files);
  if (files.length === 0) {
    return {
      text: "validate_files requires at least one file.",
      fileCount: 0,
      totalCount: 0,
      totalErrorCount: 0,
      totalWarningCount: 0,
      files: [],
      ...(args.includeItems ? { items: [] } : {}),
    };
  }

  const severity = args.severity ?? "all";
  const includeItems = args.includeItems ?? false;

  const snapshots = await Promise.all(
    files.map(async (file) => {
      const normalizedFile = path.isAbsolute(file)
        ? path.relative(session.rootDir, file)
        : file;
      const snapshot = await getErrorsAndFixes(session, {
        file: normalizedFile,
        severity,
      });
      return {
        file: normalizedFile,
        snapshot,
      };
    }),
  );

  const fileSummaries = snapshots
    .map(({ file, snapshot }) => ({
      file,
      totalCount: snapshot.totalCount,
      totalErrorCount: snapshot.totalErrorCount,
      totalWarningCount: snapshot.totalWarningCount,
    }))
    .sort((left, right) => {
      if (right.totalErrorCount !== left.totalErrorCount) {
        return right.totalErrorCount - left.totalErrorCount;
      }
      if (right.totalWarningCount !== left.totalWarningCount) {
        return right.totalWarningCount - left.totalWarningCount;
      }
      return left.file.localeCompare(right.file);
    });

  const items = includeItems
    ? fileSummaries.flatMap((summary) =>
        snapshots.find(({ file }) => file === summary.file)?.snapshot.items ?? [],
      )
    : undefined;

  const totalCount = fileSummaries.reduce(
    (sum, summary) => sum + summary.totalCount,
    0,
  );
  const totalErrorCount = fileSummaries.reduce(
    (sum, summary) => sum + summary.totalErrorCount,
    0,
  );
  const totalWarningCount = fileSummaries.reduce(
    (sum, summary) => sum + summary.totalWarningCount,
    0,
  );

  const lines = [
    `Validated ${fileSummaries.length} file${fileSummaries.length === 1 ? "" : "s"}.`,
    totalCount === 0
      ? "No diagnostics found."
      : `${totalCount} diagnostics (${totalErrorCount} errors, ${totalWarningCount} warnings)`,
    "",
    ...fileSummaries.map(formatValidationSummary),
  ];

  return {
    text: lines.join("\n").trim(),
    fileCount: fileSummaries.length,
    totalCount,
    totalErrorCount,
    totalWarningCount,
    files: fileSummaries,
    ...(includeItems ? { items } : {}),
  };
}
