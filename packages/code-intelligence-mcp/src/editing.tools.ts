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
import {
  formatProjectScope,
} from "@featuretype/code-intelligence/text";
import { textResult } from "./mcp-result.ts";
import { fileInput, positionInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@featuretype/code-intelligence";
import {
  type FileMove,
  renderWorkspaceEdit,
} from "./workspace-edit.ts";
import { formatPatchResult } from "./edit-result.ts";

const input = type.module({
  RenameSymbol: type({
    ...fileInput,
    position: positionInput,
    newName: "string >= 1",
  }).onUndeclaredKey("reject"),
  RenameFiles: type({
    workspace: fileInput.workspace,
    files: type({
      from: "string >= 1",
      to: "string >= 1",
    }).onUndeclaredKey("reject").array().atLeastLength(1),
  }).onUndeclaredKey("reject"),
  FormatDocument: type({
    ...fileInput,
    tabSize: type("number.integer >= 1").default(2),
    insertSpaces: type("boolean").default(true),
    "trimTrailingWhitespace?": "boolean",
    "insertFinalNewline?": "boolean",
    "trimFinalNewlines?": "boolean",
  }).onUndeclaredKey("reject"),
});

export const registerEditingTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): void => {
  server.registerTool(
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
        workspace.sendRequest(
          RenameRequest.type,
          { textDocument, position, newName },
          signal,
        ),
        workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal),
      ]);
      if (!edit) return textResult("");
      const rendered = await renderWorkspaceEdit(workspace, root, edit);
      return formatPatchResult(
        `Rename to ${newName} · ${formatProjectScope(project, root)}`,
        rendered,
      );
    },
  );

  server.registerTool(
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
      const moves: FileMove[] = await Promise.all(files.map(async ({ from, to }) => ({
        oldUri: (await workspace.getTextDocument(from)).uri,
        newUri: workspace.getWorkspaceUri(to),
      })));
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

  server.registerTool(
    "format_document",
    {
      title: "Format document",
      description:
        "Return a Codex patch containing document-formatting edits. The MCP does not modify files.",
      inputSchema: input.FormatDocument,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, ...options }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const edits = await workspace.sendRequest(
        DocumentFormattingRequest.type,
        { textDocument, options },
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
