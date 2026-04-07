import { describe, expect, it } from "vitest";
import type { DiagnosticsSession } from "@featuretype/language-server";
import type { Diagnostic, Range } from "vscode-languageserver-protocol";
import { validateFiles } from "./validation.js";

function createDiagnostic(
  line: number,
  character: number,
  message: string,
  severity: 1 | 2,
  code = "TS2322",
): Diagnostic {
  return {
    range: {
      start: { line, character },
      end: { line, character: character + 1 },
    },
    severity,
    code,
    message,
    source: "ts",
  };
}

function createSessionMock(
  rootDir: string,
  diagnosticsByFile: Record<string, Diagnostic[]>,
): DiagnosticsSession {
  return {
    rootDir,
    tsdk: `${rootDir}/node_modules/typescript/lib`,
    getFileDiagnostics: async (filePath: string) =>
      diagnosticsByFile[filePath] ?? [],
    getFileCodeActions: async (
      _filePath: string,
      _range: Range,
      _diagnostics: Diagnostic[],
    ) => [],
  } as unknown as DiagnosticsSession;
}

describe("validateFiles", () => {
  it("summarizes diagnostics across multiple files", async () => {
    const session = createSessionMock("/repo", {
      "/repo/src/a.ts": [
        createDiagnostic(0, 14, "Type 'number' is not assignable to type 'string'.", 1),
      ],
      "/repo/src/b.ts": [
        createDiagnostic(1, 4, "Unused variable.", 2, "TS6133"),
      ],
      "/repo/src/c.ts": [],
    });

    const summary = await validateFiles(session, {
      files: ["src/a.ts", "src/b.ts", "src/c.ts"],
      severity: "all",
      includeItems: true,
    });

    expect(summary.fileCount).toBe(3);
    expect(summary.totalCount).toBe(2);
    expect(summary.totalErrorCount).toBe(1);
    expect(summary.totalWarningCount).toBe(1);
    expect(summary.files[0]).toMatchObject({
      file: "src/a.ts",
      totalErrorCount: 1,
    });
    expect(summary.files[2]).toMatchObject({
      file: "src/c.ts",
      totalCount: 0,
    });
    expect(summary.items).toHaveLength(2);
    expect(summary.text).toContain("Validated 3 files.");
    expect(summary.text).toContain("src/c.ts: clean");
  });
});
