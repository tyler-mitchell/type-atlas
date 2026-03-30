/**
 * get_definition — go to definition, resolved through re-exports.
 * get_references — find all references (type-aware).
 */

import { URI } from "vscode-uri";
import * as path from "node:path";
import type { VolarHost } from "../volar-host.js";
import { explainFailure } from "../failure.js";

export async function getDefinition(
  host: VolarHost,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(host.rootDir, args.file);
  const uri = URI.file(absPath);
  const position = { line: args.line - 1, character: args.col - 1 };

  const locations = await host.languageService.getDefinition(uri, position);
  if (!locations || locations.length === 0) {
    return explainFailure("get_definition", args.file, host, {
      position: `${args.line}:${args.col}`,
    });
  }

  const results = locations.map((loc) => {
    const targetPath = path.relative(
      host.rootDir,
      URI.parse(loc.targetUri).fsPath,
    );
    const line = loc.targetRange.start.line + 1;
    const col = loc.targetRange.start.character + 1;
    return `${targetPath}:${line}:${col}`;
  });

  return results.join("\n");
}

export async function getReferences(
  host: VolarHost,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(host.rootDir, args.file);
  const uri = URI.file(absPath);
  const position = { line: args.line - 1, character: args.col - 1 };

  const locations = await host.languageService.getReferences(uri, position, {
    includeDeclaration: true,
  });
  if (!locations || locations.length === 0) {
    return explainFailure("get_references", args.file, host, {
      position: `${args.line}:${args.col}`,
    });
  }

  const results = locations.map((loc) => {
    const refPath = path.relative(host.rootDir, URI.parse(loc.uri).fsPath);
    const line = loc.range.start.line + 1;
    const col = loc.range.start.character + 1;
    return `${refPath}:${line}:${col}`;
  });

  return `${results.length} references:\n${results.join("\n")}`;
}
