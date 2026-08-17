import type { McpServer } from "@modelcontextprotocol/server";
import {
  DocumentFormattingRequest,
  GetMatchTsConfigRequest,
  RenameRequest,
  WillRenameFilesRequest,
  WorkspaceChange,
} from "@volar/language-server/protocol.js";
import { type } from "arktype";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { formatScope } from "@type-atlas/core/text";
import { textResult } from "./mcp-result.ts";
import { fileInput, positionInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@type-atlas/core";
import { type FileMove, renderWorkspaceEdit } from "./workspace-edit.ts";
import { formatPatchResult } from "./edit-result.ts";
import { registerTool } from "./tool.ts";

const input = type.module({
  RenameSymbol: type({
    ...fileInput,
    position: positionInput,
    newName: type("string >= 1").describe("New identifier for the symbol at that position."),
  }),
  RenameFiles: type({
    workspace: fileInput.workspace,
    files: type({
      from: type("string >= 1").describe("Current workspace-relative or absolute path."),
      to: type("string >= 1").describe("Destination path for the move."),
    })
      .array()
      .atLeastLength(1)
      .configure(
        {
          description:
            "One or more { from, to } file moves applied together, so references are updated across the whole set.",
        },
        "self",
      ),
  }),
  FormatDocument: type({
    ...fileInput,
    "tabSize?": type("number.integer >= 1").configure({
      default: 2,
      description: "Columns per indentation level.",
    }),
    "insertSpaces?": type("boolean").configure({
      default: true,
      description: "Indent with spaces rather than tabs.",
    }),
    "trimTrailingWhitespace?": type("boolean").configure({
      description: "Remove trailing whitespace from every line.",
    }),
    "insertFinalNewline?": type("boolean").configure({
      description: "Ensure the file ends with a newline.",
    }),
    "trimFinalNewlines?": type("boolean").configure({
      description: "Collapse repeated trailing newlines at the end of the file.",
    }),
  }),
});

export const registerEditingTools = (server: McpServer, workspaces: VolarWorkspacePool): void => {
  registerTool(
    server,
    "rename_symbol",
    {
      title: "Rename symbol",
      description:
        "Return a Codex patch for a TypeScript-project symbol rename at a source position. The MCP does not modify files.",
      inputSchema: input.RenameSymbol,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, newName }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const [edit, project] = await Promise.all([
        workspace.sendRequest(RenameRequest.type, { textDocument, position, newName }, signal),
        workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal),
      ]);
      if (!edit) return textResult("");
      const rendered = await renderWorkspaceEdit(workspace, root, edit);
      return formatPatchResult(
        `Rename to ${newName} · ${formatScope("project", project, root)}`,
        rendered,
      );
    },
  );

  registerTool(
    server,
    "rename_files",
    {
      title: "Rename files",
      description:
        "Return a Codex patch that moves files and updates affected references. The MCP does not modify files.",
      inputSchema: input.RenameFiles,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, files }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const moves: FileMove[] = await Promise.all(
        files.map(async ({ from, to }) => ({
          oldUri: (await workspace.getTextDocument(from)).uri,
          newUri: workspace.getWorkspaceUri(to),
        })),
      );
      const edit = await workspace.sendRequest(
        WillRenameFilesRequest.type,
        { files: moves },
        signal,
      );
      return formatPatchResult(
        `Rename ${moves.length} ${moves.length === 1 ? "file" : "files"}`,
        await renderWorkspaceEdit(workspace, root, edit ?? {}, moves),
      );
    },
  );

  registerTool(
    server,
    "format_document",
    {
      title: "Format document",
      description:
        "Return a Codex patch containing document-formatting edits. The MCP does not modify files.",
      inputSchema: input.FormatDocument,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, tabSize = 2, insertSpaces = true, ...rest },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const edits = await workspace.sendRequest(
        DocumentFormattingRequest.type,
        { textDocument, options: { tabSize, insertSpaces, ...rest } },
        signal,
      );
      if (!edits?.length) return textResult("");
      const change = new WorkspaceChange();
      const textChanges = change.getTextEditChange({
        uri: textDocument.uri,
        version: null,
      });
      for (const edit of edits) textChanges.add(edit);
      return formatPatchResult(
        "Format document",
        await renderWorkspaceEdit(workspace, root, change.edit),
      );
    },
  );
};
