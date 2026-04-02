import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiagnosticsSession, type DiagnosticsSession } from "./diagnostics.js";

const featuretypeRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
);

describe("createDiagnosticsSession signature help", () => {
  let session: DiagnosticsSession | undefined;

  afterEach(async () => {
    await session?.dispose();
    session = undefined;
  });

  it("finds signature help from nearby call-site positions", async () => {
    session = await createDiagnosticsSession({ rootDir: featuretypeRoot });
    const filePath = path.resolve(featuretypeRoot, "packages/mcp/src/testing.ts");

    const calleeStart = await session.getFileSignatureHelp(filePath, {
      line: 8,
      character: 21,
    });
    const openParen = await session.getFileSignatureHelp(filePath, {
      line: 8,
      character: 29,
    });
    const firstArg = await session.getFileSignatureHelp(filePath, {
      line: 8,
      character: 30,
    });

    expect(calleeStart?.signatures[0]?.label).toBe(
      "resolve(...paths: string[]): string",
    );
    expect(openParen?.signatures[0]?.label).toBe(
      "resolve(...paths: string[]): string",
    );
    expect(firstArg?.signatures[0]?.label).toBe(
      "resolve(...paths: string[]): string",
    );
  }, 15_000);
});
