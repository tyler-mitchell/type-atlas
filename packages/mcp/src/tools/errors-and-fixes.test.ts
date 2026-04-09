import type * as vscode from "vscode-languageserver-protocol";
import { describe, expect, it } from "vitest";
import {
  extractCodeActionFixes,
  filterApplicableCodeActions,
} from "./errors-and-fixes.js";

const baseFormattedDiagnostic = {
  file: "src/value.ts",
  line: 2,
  col: 1,
  endLine: 2,
  endCol: 4,
  severity: "error" as const,
  code: "TS1111",
  message: "Broken thing",
};

describe("extractCodeActionFixes", () => {
  it("keeps concrete fixes and drops refactors by default", () => {
    const actions = [
      {
        title: "Keep (edits)",
        kind: "quickfix",
        edit: {
          changes: {
            "file:///repo/src/value.ts": [
              {
                range: {
                  start: { line: 1, character: 0 },
                  end: { line: 1, character: 3 },
                },
                newText: "x",
              },
            ],
          },
        },
      },
      {
        title: "Drop (refactor)",
        kind: "refactor.rewrite.arrow.braces.remove",
        edit: {
          changes: {
            "file:///repo/src/value.ts": [
              {
                range: {
                  start: { line: 3, character: 0 },
                  end: { line: 3, character: 3 },
                },
                newText: "y",
              },
            ],
          },
        },
      },
      {
        title: "Command only",
        command: "noop",
      },
    ] as Array<vscode.CodeAction | vscode.Command>;

    const fixes = extractCodeActionFixes("/repo", actions, {
      includeEmptyFixes: false,
      includeRefactors: false,
    });

    expect(fixes).toEqual([
      {
        title: "Keep (edits)",
        kind: "quickfix",
        edits: [
          {
            file: "src/value.ts",
            line: 2,
            newText: "x",
          },
        ],
      },
    ]);
  });

  it("returns no-op quick fixes when includeEmptyFixes is true", () => {
    const actions = [
      {
        title: "Keep (edits)",
        kind: "quickfix",
        edit: {
          changes: {
            "file:///repo/src/value.ts": [
              {
                range: {
                  start: { line: 1, character: 0 },
                  end: { line: 1, character: 3 },
                },
                newText: "x",
              },
            ],
          },
        },
      },
      {
        title: "Keep (no edits)",
        kind: "quickfix",
      },
      {
        title: "Drop (refactor)",
        kind: "refactor.extract.function",
      },
    ] as Array<vscode.CodeAction | vscode.Command>;

    const fixes = extractCodeActionFixes("/repo", actions, {
      includeEmptyFixes: true,
      includeRefactors: false,
    });

    expect(fixes).toEqual([
      {
        title: "Keep (edits)",
        kind: "quickfix",
        edits: [
          {
            file: "src/value.ts",
            line: 2,
            newText: "x",
          },
        ],
      },
      {
        title: "Keep (no edits)",
        kind: "quickfix",
        edits: [],
      },
    ]);
  });

  it("includes refactors when explicitly requested", () => {
    const actions = [
      {
        title: "Keep (edits)",
        kind: "quickfix",
        edit: {
          changes: {
            "file:///repo/src/value.ts": [
              {
                range: {
                  start: { line: 1, character: 0 },
                  end: { line: 1, character: 3 },
                },
                newText: "x",
              },
            ],
          },
        },
      },
      {
        title: "Keep (refactor)",
        kind: "refactor.extract.constant",
        edit: {
          changes: {
            "file:///repo/src/value.ts": [
              {
                range: {
                  start: { line: 3, character: 0 },
                  end: { line: 3, character: 3 },
                },
                newText: "y",
              },
            ],
          },
        },
      },
    ] as Array<vscode.CodeAction | vscode.Command>;

    const fixes = extractCodeActionFixes("/repo", actions, {
      includeEmptyFixes: false,
      includeRefactors: true,
    });

    expect(fixes).toEqual([
      {
        title: "Keep (edits)",
        kind: "quickfix",
        edits: [
          {
            file: "src/value.ts",
            line: 2,
            newText: "x",
          },
        ],
      },
      {
        title: "Keep (refactor)",
        kind: "refactor.extract.constant",
        edits: [
          {
            file: "src/value.ts",
            line: 4,
            newText: "y",
          },
        ],
      },
    ]);
  });

  it("keeps only actions attached to the target diagnostic", () => {
    const actions = [
      {
        title: "Keep (matching diagnostic)",
        kind: "quickfix",
        diagnostics: [
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 3 },
            },
            severity: 1,
            code: 1111,
            message: "Broken thing",
          },
        ],
      },
      {
        title: "Drop (different diagnostic)",
        kind: "quickfix",
        diagnostics: [
          {
            range: {
              start: { line: 4, character: 0 },
              end: { line: 4, character: 2 },
            },
            severity: 1,
            code: 2222,
            message: "Different problem",
          },
        ],
      },
      {
        title: "Drop (source action)",
        kind: "source.organizeImports",
      },
      {
        title: "Drop (command only)",
        command: "noop",
      },
    ] as Array<vscode.CodeAction | vscode.Command>;

    const applicable = filterApplicableCodeActions(baseFormattedDiagnostic, actions, {
      includeRefactors: false,
    });

    expect(applicable.map((action) => action.title)).toEqual([
      "Keep (matching diagnostic)",
    ]);
  });

  it("keeps diagnostic-free quick fixes but still drops non-fix actions", () => {
    const actions = [
      {
        title: "Keep (diagnostic-free quickfix)",
        kind: "quickfix",
      },
      {
        title: "Drop (source action)",
        kind: "source.fixAll",
      },
      {
        title: "Drop (refactor)",
        kind: "refactor.extract.function",
      },
    ] as Array<vscode.CodeAction | vscode.Command>;

    const applicable = filterApplicableCodeActions(baseFormattedDiagnostic, actions, {
      includeRefactors: false,
    });

    expect(applicable.map((action) => action.title)).toEqual([
      "Keep (diagnostic-free quickfix)",
    ]);
  });
});
