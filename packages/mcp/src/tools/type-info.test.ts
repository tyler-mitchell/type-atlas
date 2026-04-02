import { describe, expect, it } from "vitest";
import type { DiagnosticsSession } from "@featuretype/language-server";
import type { Position, SignatureHelp } from "vscode-languageserver-protocol";
import { getSignature } from "./type-info.js";

function createSignatureHelp(label: string): SignatureHelp {
  return {
    activeParameter: 0,
    activeSignature: 0,
    signatures: [
      {
        label,
        parameters: [
          { label: "alpha" },
          { label: "beta" },
        ],
      },
    ],
  };
}

function createSessionMock(
  rootDir: string,
  options: {
    content: string;
    signaturePositions: Position[];
  },
): DiagnosticsSession {
  const acceptedPositions = new Set(
    options.signaturePositions.map(
      (position) => `${position.line}:${position.character}`,
    ),
  );

  return {
    rootDir,
    tsdk: `${rootDir}/node_modules/typescript/lib`,
    getFileContent: () => options.content,
    getFileSignatureHelp: async (_filePath, position) =>
      acceptedPositions.has(`${position.line}:${position.character}`)
        ? createSignatureHelp("fn(alpha: string, beta: string): void")
        : null,
  } as unknown as DiagnosticsSession;
}

describe("getSignature", () => {
  it("falls back from the callee name into the first argument", async () => {
    const session = createSessionMock("/repo", {
      content: "const value = fn(alpha, beta);\n",
      signaturePositions: [{ line: 0, character: 17 }],
    });

    const text = await getSignature(session, {
      file: "src/example.ts",
      line: 1,
      col: 15,
    });

    expect(text).toContain("fn(alpha: string, beta: string): void");
  });

  it("falls forward from multiline indentation into the active argument", async () => {
    const session = createSessionMock("/repo", {
      content: "const value = fn(\n  alpha,\n  beta,\n);\n",
      signaturePositions: [{ line: 1, character: 2 }],
    });

    const text = await getSignature(session, {
      file: "src/example.ts",
      line: 2,
      col: 1,
    });

    expect(text).toContain("fn(alpha: string, beta: string): void");
  });
});
