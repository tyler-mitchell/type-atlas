import type * as vscode from "vscode-languageserver-protocol";
import { describe, expect, it } from "vitest";
import { extractCodeActionFixes } from "./errors-and-fixes.js";

describe("extractCodeActionFixes", () => {
  it("filters out fixes that have no file edits by default", () => {
    const actions = [
      {
        title: "Keep (edits)",
        kind: "refactor.rewrite.string",
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
        title: "Drop (no edits)",
        kind: "refactor.rewrite.arrow.braces.remove",
      },
      {
        title: "Command only",
        command: "noop",
      },
    ] as Array<vscode.CodeAction | vscode.Command>;

    const fixes = extractCodeActionFixes("/repo", actions, false);

    expect(fixes).toEqual([
      {
        title: "Keep (edits)",
        kind: "refactor.rewrite.string",
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

  it("returns no-op and command-only fixes when includeEmptyFixes is true", () => {
    const actions = [
      {
        title: "Keep (edits)",
        kind: "refactor.rewrite.string",
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
        kind: "refactor.rewrite.arrow.braces.remove",
      },
      {
        title: "Command only",
        command: "noop",
      },
    ] as Array<vscode.CodeAction | vscode.Command>;

    const fixes = extractCodeActionFixes("/repo", actions, true);

    expect(fixes).toEqual([
      {
        title: "Keep (edits)",
        kind: "refactor.rewrite.string",
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
        kind: "refactor.rewrite.arrow.braces.remove",
        edits: [],
      },
      {
        title: "Command only",
        kind: "command",
        edits: [],
      },
    ]);
  });
});
