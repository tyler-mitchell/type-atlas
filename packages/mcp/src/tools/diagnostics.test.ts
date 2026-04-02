import { describe, expect, it } from "vitest";
import type { DiagnosticsSession } from "@featuretype/language-server";
import { getDiagnostics, snapshotBaseline } from "./diagnostics.js";

type MinimalDiagnostic = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  code: number | string;
  severity?: number;
};

function createSessionMock(
  rootDir: string,
  diagnosticsByFile: Record<string, MinimalDiagnostic[]>,
): DiagnosticsSession {
  return {
    rootDir,
    tsdk: `${rootDir}/node_modules/typescript/lib`,
    getProjectFileNames: async () =>
      Object.keys(diagnosticsByFile).map((file) => `${rootDir}/${file}`),
    getFileDiagnostics: async (filePath: string) => {
      const relPath = filePath.replace(`${rootDir}/`, "");
      return (diagnosticsByFile[relPath] ?? []) as never;
    },
  } as unknown as DiagnosticsSession;
}

function makeDiagnostic(
  line: number,
  code: number,
  message: string,
  severity = 1,
): MinimalDiagnostic {
  return {
    range: {
      start: { line, character: 0 },
      end: { line, character: 10 },
    },
    message,
    code,
    severity,
  };
}

describe("getDiagnostics", () => {
  it("returns accurate scope counts in summary mode", async () => {
    const diagnosticsByFile = {
      "src/example.ts": [
        makeDiagnostic(0, 1001, "baseline error"),
        makeDiagnostic(1, 2001, "baseline warning", 2),
      ],
    };
    const session = createSessionMock("/repo", diagnosticsByFile);

    await snapshotBaseline(session);

    diagnosticsByFile["src/example.ts"] = [
      ...diagnosticsByFile["src/example.ts"],
      makeDiagnostic(2, 3001, "new error"),
    ];

    const snapshot = await getDiagnostics(session, {
      summary: true,
      scope: "all",
      severity: "all",
    });

    expect(snapshot.newCount).toBe(1);
    expect(snapshot.baselineCount).toBe(2);
    expect(snapshot.totalCount).toBe(3);
    expect(snapshot.totalErrorCount).toBe(2);
    expect(snapshot.totalWarningCount).toBe(1);
    expect(snapshot.text).toContain(
      "3 diagnostics (2 errors, 1 warnings | 1 new, 2 baseline)",
    );
  });

  it("includes structured per-file summaries with source files before generated output", async () => {
    const session = createSessionMock("/repo", {
      "dist/generated.js": [makeDiagnostic(0, 1001, "generated error")],
      "src/example.ts": [
        makeDiagnostic(0, 2001, "source error"),
        makeDiagnostic(1, 2002, "source warning", 2),
      ],
    });

    const snapshot = await getDiagnostics(session, {
      summary: true,
      scope: "all",
      severity: "all",
    });

    expect(snapshot.files).toEqual([
      {
        file: "src/example.ts",
        totalCount: 2,
        totalErrorCount: 1,
        totalWarningCount: 1,
        newCount: 2,
        baselineCount: 0,
        generated: false,
      },
      {
        file: "dist/generated.js",
        totalCount: 1,
        totalErrorCount: 1,
        totalWarningCount: 0,
        newCount: 1,
        baselineCount: 0,
        generated: true,
      },
    ]);
    expect(snapshot.text).toContain("src/example.ts: 1 errors, 1 warnings (2 new)");
    expect(snapshot.text).toContain("dist/generated.js [generated]: 1 errors (1 new)");
  });
});
