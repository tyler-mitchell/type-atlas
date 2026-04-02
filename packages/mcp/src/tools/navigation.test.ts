import { describe, expect, it } from "vitest";
import type { DiagnosticsSession } from "@featuretype/language-server";
import type { Location, LocationLink } from "vscode-languageserver-protocol";
import { getImplementations } from "./navigation.js";

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
  } = {},
): DiagnosticsSession {
  return {
    rootDir,
    tsdk: `${rootDir}/node_modules/typescript/lib`,
    getFileDefinition: async () => options.definitions ?? [],
    getFileImplementations: async () => options.implementations ?? [],
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
