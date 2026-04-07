import { describe, expect, it } from "vitest";
import { collectWorkspaceTextEdits } from "./workspace-edits.js";

describe("collectWorkspaceTextEdits", () => {
  it("collects legacy changes and document changes", () => {
    const edits = collectWorkspaceTextEdits("/repo", {
      changes: {
        "file:///repo/src/a.ts": [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            newText: "alpha",
          },
        ],
      },
      documentChanges: [
        {
          textDocument: {
            uri: "file:///repo/src/b.ts",
            version: null,
          },
          edits: [
            {
              range: {
                start: { line: 2, character: 4 },
                end: { line: 2, character: 8 },
              },
              newText: "beta",
            },
          ],
        },
      ],
    });

    expect(edits).toEqual([
      {
        file: "src/a.ts",
        line: 1,
        newText: "alpha",
      },
      {
        file: "src/b.ts",
        line: 3,
        newText: "beta",
      },
    ]);
  });
});
