/**
 * Structured failure explanations for semantic tool queries.
 *
 * Instead of opaque "No X found" messages, explains WHY a query failed
 * so agents can adjust their approach.
 */

import * as path from "node:path";
import type { VolarHost } from "./volar-host.js";

interface FailureContext {
  position?: string;
  hint?: string;
}

export function explainFailure(
  tool: string,
  file: string,
  host: VolarHost,
  ctx?: FailureContext,
): string {
  const status = host.getFileStatus(file);
  const absPath = path.resolve(host.rootDir, file);
  const lines: string[] = [];

  lines.push(`${tool}: no result for ${file}${ctx?.position ? `:${ctx.position}` : ""}`);
  lines.push("");

  if (!status.exists) {
    lines.push(`Reason: file does not exist at ${absPath}`);
    return lines.join("\n");
  }

  if (!status.isInRoot) {
    lines.push("Reason: file is outside the project root.");
    lines.push(`  Project root: ${host.rootDir}`);
    lines.push(`  File resolves to: ${absPath}`);
    lines.push("");
    lines.push(
      "Diagnostics may still work on out-of-root files, but semantic queries (type info, definition, references) require the file to be part of the TypeScript project graph. Consider using attach_project to add this project root.",
    );
    return lines.join("\n");
  }

  if (!status.inProjectGraph) {
    lines.push("Reason: file is inside the project root but not part of the TypeScript project graph.");
    lines.push(`  This means the file is not included in the tsconfig at ${host.rootDir}`);
    if (status.isFeatureType) {
      lines.push("  .featuretype files participate via Volar virtual code — embedded code blocks should produce diagnostics but semantic navigation into them is limited.");
    } else {
      lines.push("  Check tsconfig.json include/exclude patterns.");
    }
    return lines.join("\n");
  }

  if (status.isFeatureType) {
    lines.push("Reason: position may not be inside an embedded code block.");
    lines.push("  Semantic queries work inside <recipe>, <showcase>, and <example> code blocks.");
    lines.push("  Structural text blocks (intent, anatomy, etc.) do not have TypeScript semantics.");
    return lines.join("\n");
  }

  // File is in project, exists, is in root — the position just doesn't resolve
  lines.push("Reason: no resolvable symbol at this position.");
  lines.push("  The cursor may be on whitespace, a keyword, a string literal, or a comment.");
  if (ctx?.hint) {
    lines.push(`  Hint: ${ctx.hint}`);
  }

  return lines.join("\n");
}
