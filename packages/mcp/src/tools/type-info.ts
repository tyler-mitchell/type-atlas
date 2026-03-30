/**
 * get_type_at — hover equivalent, returns inferred type at a position.
 * get_signature — signature help at a call site.
 */

import { URI } from "vscode-uri";
import * as path from "node:path";
import type { VolarHost } from "../volar-host.js";
import { explainFailure } from "../failure.js";

export async function getTypeAt(
  host: VolarHost,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(host.rootDir, args.file);
  const uri = URI.file(absPath);
  const position = { line: args.line - 1, character: args.col - 1 };

  const hover = await host.languageService.getHover(uri, position);
  if (!hover) {
    return explainFailure("get_type_at", args.file, host, {
      position: `${args.line}:${args.col}`,
    });
  }

  const content =
    typeof hover.contents === "string"
      ? hover.contents
      : "kind" in hover.contents
        ? hover.contents.value
        : hover.contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n");

  return content;
}

export async function getSignature(
  host: VolarHost,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(host.rootDir, args.file);
  const uri = URI.file(absPath);
  const position = { line: args.line - 1, character: args.col - 1 };

  const help = await host.languageService.getSignatureHelp(uri, position);
  if (!help || help.signatures.length === 0) {
    return explainFailure("get_signature", args.file, host, {
      position: `${args.line}:${args.col}`,
      hint: "Signature help requires the cursor to be inside a function call's argument list.",
    });
  }

  const lines: string[] = [];
  for (const sig of help.signatures) {
    lines.push(sig.label);
    if (sig.documentation) {
      const doc =
        typeof sig.documentation === "string"
          ? sig.documentation
          : sig.documentation.value;
      lines.push(doc);
    }
    if (sig.parameters) {
      for (const param of sig.parameters) {
        const paramLabel =
          typeof param.label === "string"
            ? param.label
            : sig.label.slice(param.label[0], param.label[1]);
        const paramDoc = param.documentation
          ? typeof param.documentation === "string"
            ? param.documentation
            : param.documentation.value
          : "";
        lines.push(`  ${paramLabel}${paramDoc ? " — " + paramDoc : ""}`);
      }
    }
  }
  return lines.join("\n");
}
