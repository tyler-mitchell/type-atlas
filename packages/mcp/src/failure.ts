/**
 * Structured failure explanations for semantic tool queries.
 *
 * Instead of opaque "No X found" messages, explains WHY a query failed
 * so agents can adjust their approach. Every failure has a machine-readable
 * `code` field alongside prose so agents can branch programmatically.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { DiagnosticsSession } from "@featuretype/language-server";

/**
 * Machine-readable failure codes.
 *
 * - NOT_FOUND: file does not exist on disk and is not registered as virtual
 * - OUT_OF_SCOPE: file is outside every attached project root
 * - NOT_IN_GRAPH: file is in the project root but excluded from tsconfig
 * - NO_SYMBOL: file is valid but the position has no resolvable symbol
 * - FEATURETYPE_BLOCK: position is in a non-code block of a .featuretype file
 */
export type FailureCode =
  | "NOT_FOUND"
  | "OUT_OF_SCOPE"
  | "NOT_IN_GRAPH"
  | "NO_SYMBOL"
  | "FEATURETYPE_BLOCK";

export interface SemanticFailure {
  code: FailureCode;
  message: string;
}

interface FailureContext {
  position?: string;
  hint?: string;
}

function buildFailure(code: FailureCode, lines: string[]): SemanticFailure {
  return { code, message: lines.join("\n") };
}

export async function classifyFailure(
  tool: string,
  file: string,
  session: DiagnosticsSession,
  ctx?: FailureContext,
): Promise<SemanticFailure> {
  const absPath = path.isAbsolute(file)
    ? path.resolve(file)
    : path.resolve(session.rootDir, file);
  const existsOnDisk = fs.existsSync(absPath);
  const isVirtual = session.isVirtualFile(file);
  const isInRoot =
    absPath === session.rootDir || absPath.startsWith(`${session.rootDir}${path.sep}`);
  const inProjectGraph =
    isVirtual ||
    (isInRoot ? (await session.getProjectFileNames()).includes(absPath) : false);
  const isFeatureType = absPath.endsWith(".featuretype");
  const header = `${tool}: no result for ${file}${ctx?.position ? `:${ctx.position}` : ""}`;

  if (!existsOnDisk && !isVirtual) {
    return buildFailure("NOT_FOUND", [
      header,
      "",
      `Reason: file does not exist at ${absPath} and is not registered as a virtual file.`,
      "Use open_virtual_file to register in-memory content, or write the file to disk first.",
    ]);
  }

  if (!isInRoot) {
    return buildFailure("OUT_OF_SCOPE", [
      header,
      "",
      "Reason: file is outside the project root.",
      `  Project root: ${session.rootDir}`,
      `  File resolves to: ${absPath}`,
      "",
      "Semantic queries require the file to be part of the TypeScript project graph.",
      "Use attach_project to add the correct project root.",
    ]);
  }

  if (!inProjectGraph) {
    const lines = [
      header,
      "",
      "Reason: file is inside the project root but not part of the TypeScript project graph.",
      `  This means the file is not included in the tsconfig at ${session.rootDir}`,
    ];
    if (isFeatureType) {
      lines.push(
        "  .featuretype files participate via Volar virtual code — embedded code blocks should produce diagnostics but semantic navigation into them is limited.",
      );
    } else {
      lines.push("  Check tsconfig.json include/exclude patterns, or use open_virtual_file to register the file explicitly.");
    }
    return buildFailure("NOT_IN_GRAPH", lines);
  }

  if (isFeatureType) {
    return buildFailure("FEATURETYPE_BLOCK", [
      header,
      "",
      "Reason: position may not be inside an embedded code block.",
      "  Semantic queries work inside <recipe>, <showcase>, and <example> code blocks.",
      "  Structural text blocks (intent, anatomy, etc.) do not have TypeScript semantics.",
    ]);
  }

  const lines = [
    header,
    "",
    "Reason: no resolvable symbol at this position.",
    "  The cursor may be on whitespace, a keyword, a string literal, or a comment.",
  ];
  if (ctx?.hint) {
    lines.push(`  Hint: ${ctx.hint}`);
  }
  return buildFailure("NO_SYMBOL", lines);
}

/**
 * @deprecated Use classifyFailure for structured results. This wrapper exists
 * for call sites that only need the prose message.
 */
export async function explainFailure(
  tool: string,
  file: string,
  session: DiagnosticsSession,
  ctx?: FailureContext,
): Promise<string> {
  const failure = await classifyFailure(tool, file, session, ctx);
  return failure.message;
}
