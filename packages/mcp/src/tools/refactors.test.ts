import { describe, expect, it } from "vitest";
import type { DiagnosticsSession } from "@featuretype/language-server";
import type { WorkspaceEdit } from "vscode-languageserver-protocol";
import { getFileRenameEdits, getRenameEdits, prepareRename } from "./refactors.js";

function createSessionMock(
  rootDir: string,
  options: {
    prepareRenameResult?: Awaited<ReturnType<DiagnosticsSession["prepareFileRename"]>>;
    renameEdit?: WorkspaceEdit | null;
    fileRenameEdit?: WorkspaceEdit | null;
  } = {},
): DiagnosticsSession {
  return {
    rootDir,
    tsdk: `${rootDir}/node_modules/typescript/lib`,
    prepareFileRename: async () => options.prepareRenameResult ?? null,
    getFileRenameEdits: async () => options.renameEdit ?? null,
    getWorkspaceFileRenameEdits: async () => options.fileRenameEdit ?? null,
  } as unknown as DiagnosticsSession;
}

describe("refactor tools", () => {
  it("formats prepare rename results", async () => {
    const session = createSessionMock("/repo", {
      prepareRenameResult: {
        range: {
          start: { line: 10, character: 4 },
          end: { line: 10, character: 19 },
        },
        placeholder: "createLlmClient",
      },
    });

    const text = await prepareRename(session, {
      file: "src/client.ts",
      line: 11,
      col: 5,
    });

    expect(text).toContain("Rename available at 11:5-11:20");
    expect(text).toContain("Placeholder: createLlmClient");
  });

  it("summarizes text edits and rename operations", async () => {
    const session = createSessionMock("/repo", {
      renameEdit: {
        changes: {
          "file:///repo/src/client.ts": [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 4 },
              },
              newText: "next",
            },
          ],
        },
        documentChanges: [
          {
            kind: "rename",
            oldUri: "file:///repo/src/client.ts",
            newUri: "file:///repo/src/client-core.ts",
          },
        ],
      },
    });

    const summary = await getRenameEdits(session, {
      file: "src/client.ts",
      line: 1,
      col: 1,
      newName: "next",
    });

    expect(summary.fileCount).toBe(0);
    expect(summary.textEditCount).toBe(0);
    expect(summary.renameCount).toBe(1);
    expect(summary.text).toContain("src/client.ts -> src/client-core.ts");
  });

  it("summarizes file rename edits", async () => {
    const session = createSessionMock("/repo", {
      fileRenameEdit: {
        documentChanges: [
          {
            textDocument: {
              uri: "file:///repo/src/index.ts",
              version: null,
            },
            edits: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 4 },
                },
                newText: "next",
              },
            ],
          },
        ],
      },
    });

    const summary = await getFileRenameEdits(session, {
      oldFile: "src/client.ts",
      newFile: "src/client-core.ts",
    });

    expect(summary.fileCount).toBe(1);
    expect(summary.textEditCount).toBe(1);
    expect(summary.renameCount).toBe(1);
    expect(summary.text).toContain("src/index.ts (1 edits)");
    expect(summary.text).toContain("src/client.ts -> src/client-core.ts");
  });
});
