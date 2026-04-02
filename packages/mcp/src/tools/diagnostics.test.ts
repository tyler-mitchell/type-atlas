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
});
