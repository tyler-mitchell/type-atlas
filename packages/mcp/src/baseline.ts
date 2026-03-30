/**
 * Baseline snapshot for diagnostic diffing.
 *
 * Captures a fingerprint of current diagnostics so subsequent
 * queries can distinguish new errors from pre-existing ones.
 */

import type { FormattedDiagnostic } from "./format.js";

export interface BaselineSnapshot {
  /** Timestamp of snapshot creation. */
  createdAt: number;
  /** Set of diagnostic fingerprints (file:line:code). */
  fingerprints: Set<string>;
}

function fingerprint(d: Pick<FormattedDiagnostic, "file" | "line" | "code">): string {
  return `${d.file}:${d.line}:${d.code}`;
}

export function createBaseline(diagnostics: FormattedDiagnostic[]): BaselineSnapshot {
  return {
    createdAt: Date.now(),
    fingerprints: new Set(diagnostics.map(fingerprint)),
  };
}

export function classifyDiagnostic(
  d: FormattedDiagnostic,
  baseline: BaselineSnapshot | null,
): "new" | "baseline" {
  if (!baseline) return "new";
  return baseline.fingerprints.has(fingerprint(d)) ? "baseline" : "new";
}
