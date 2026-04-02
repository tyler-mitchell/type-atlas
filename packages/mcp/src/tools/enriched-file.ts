/**
 * get_enriched_file — returns source with diagnostics woven inline.
 */

import type { DiagnosticsSession } from "@featuretype/language-server";
import * as path from "node:path";
import { formatDiagnostic, type FormattedDiagnostic } from "../format.js";
import { classifyDiagnostic } from "../baseline.js";
import { getBaseline } from "./diagnostics.js";

export async function getEnrichedFile(
  session: DiagnosticsSession,
  args: { file: string },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const relPath = path.relative(session.rootDir, absPath);

  let content: string;
  try {
    content = session.getFileContent(args.file);
  } catch {
    return `File not found: ${args.file}`;
  }

  const rawDiags = await session.getFileDiagnostics(absPath);

  if (rawDiags.length === 0) {
    return `# ${relPath} (no diagnostics)\n\n${content}`;
  }

  const baseline = getBaseline(session.rootDir);
  const diagnostics: FormattedDiagnostic[] = rawDiags.map((d) => {
    const formatted = formatDiagnostic(d, relPath, "new");
    formatted.scope = classifyDiagnostic(formatted, baseline);
    return formatted;
  });

  // Group diagnostics by line
  const diagsByLine = new Map<number, FormattedDiagnostic[]>();
  for (const d of diagnostics) {
    const existing = diagsByLine.get(d.line) ?? [];
    existing.push(d);
    diagsByLine.set(d.line, existing);
  }

  // Weave diagnostics inline
  const lines = content.split("\n");
  const output: string[] = [];
  const newCount = diagnostics.filter((d) => d.scope === "new").length;
  const baselineCount = diagnostics.filter((d) => d.scope === "baseline").length;

  output.push(`# ${relPath} — ${newCount} new, ${baselineCount} baseline diagnostics`);
  output.push("");

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const lineContent = lines[i];
    output.push(`${String(lineNum).padStart(4)} │ ${lineContent}`);

    const lineDiags = diagsByLine.get(lineNum);
    if (lineDiags) {
      for (const d of lineDiags) {
        const marker = d.severity === "error" ? "✗" : "⚠";
        const scopeTag = d.scope === "baseline" ? " [baseline]" : "";
        output.push(
          `     │ ${" ".repeat(Math.max(0, d.col - 1))}${marker} ${d.code}: ${d.message}${scopeTag}`,
        );
      }
    }
  }

  return output.join("\n");
}
