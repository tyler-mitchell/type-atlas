import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiagnosticsSession } from "@featuretype/language-server";
import type { Location, LocationLink } from "vscode-languageserver-protocol";
import { getImplementations, getReferenceSummary } from "./navigation.js";

function createLocation(
  file: string,
  line: number,
  character: number,
): Location {
  return {
    uri: `file:///repo/${file}`,
    range: {
      start: { line, character },
      end: { line, character: character + 1 },
    },
  };
}

function createSessionMock(
  rootDir: string,
  options: {
    definitions?: Array<Location | LocationLink>;
    implementations?: Array<Location | LocationLink>;
    references?: Location[];
    fileContents?: Record<string, string>;
  } = {},
): DiagnosticsSession {
  return {
    rootDir,
    tsdk: `${rootDir}/node_modules/typescript/lib`,
    getFileDefinition: async () => options.definitions ?? [],
    getFileImplementations: async () => options.implementations ?? [],
    getFileReferences: async () => options.references ?? [],
    getFileContent: (filePath: string) =>
      options.fileContents?.[path.relative(rootDir, filePath)] ?? "",
  } as unknown as DiagnosticsSession;
}

describe("getImplementations", () => {
  it("reports when implementation results only point back to the definition", async () => {
    const definition = createLocation("src/client.ts", 9, 0);
    const session = createSessionMock("/repo", {
      definitions: [definition],
      implementations: [definition],
    });

    const text = await getImplementations(session, {
      file: "src/client.ts",
      line: 10,
      col: 1,
    });

    expect(text).toContain("No distinct implementations found");
    expect(text).toContain("own definition");
  });

  it("keeps implementation results that differ from the definition", async () => {
    const definition = createLocation("src/contracts.ts", 4, 0);
    const implementation = createLocation("src/client.ts", 20, 0);
    const session = createSessionMock("/repo", {
      definitions: [definition],
      implementations: [implementation],
    });

    const text = await getImplementations(session, {
      file: "src/contracts.ts",
      line: 5,
      col: 1,
    });

    expect(text).toContain("1 implementations:");
    expect(text).toContain("src/client.ts:21:1");
  });
});

describe("getReferenceSummary", () => {
  it("groups references by file and includes representative line text", async () => {
    const session = createSessionMock("/repo", {
      references: [
        createLocation("src/shared.ts", 0, 13),
        createLocation("src/a.ts", 0, 9),
        createLocation("src/a.ts", 4, 20),
        createLocation("src/b.ts", 2, 18),
      ],
      fileContents: {
        "src/shared.ts": "export const sharedValue = 1;\n",
        "src/a.ts": [
          'import { sharedValue } from "./shared.js";',
          "export const first = sharedValue;",
          "",
          "export function readAgain() {",
          "  return sharedValue;",
          "}",
          "",
        ].join("\n"),
        "src/b.ts": [
          'import { sharedValue } from "./shared.js";',
          "",
          "export const second = sharedValue + 1;",
          "",
        ].join("\n"),
      },
    });

    const summary = await getReferenceSummary(session, {
      file: "src/shared.ts",
      line: 1,
      col: 14,
    });

    expect(summary.totalReferences).toBe(4);
    expect(summary.totalFiles).toBe(3);
    expect(summary.files[0]).toMatchObject({
      file: "src/a.ts",
      count: 2,
    });
    expect(summary.files[0]?.references[0]?.text).toContain("import { sharedValue }");
    expect(summary.text).toContain("4 references across 3 files:");
    expect(summary.text).toContain("src/a.ts (2)");
  });
});
