import type { McpServer } from "@modelcontextprotocol/server";
import {
  CodeActionRequest,
  CodeActionResolveRequest,
  CodeActionTriggerKind,
  Command,
  DocumentDiagnosticRequest,
  DocumentFormattingRequest,
  GetMatchTsConfigRequest,
  RenameRequest,
  WillRenameFilesRequest,
  WorkspaceChange,
} from "@volar/language-server/protocol.js";
import { type } from "arktype";
import { readOnlyToolAnnotations } from "./metadata.ts";
import {
  diagnosticIntersects,
  formatProjectScope,
} from "@featuretype/code-intelligence/text";
import { textResult } from "./mcp-result.ts";
import { fileInput, positionInput, rangeInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@featuretype/code-intelligence";
import {
  type FileMove,
  renderWorkspaceEdit,
} from "./workspace-edit.ts";

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
  CodeActions: type({
    ...fileInput,
    range: rangeInput,
    "only?": "string >= 1",
    "action?": "number.integer >= 1",
  }).onUndeclaredKey("reject"),
});

const formatPatchResult = (
  label: string,
  result: Awaited<ReturnType<typeof renderWorkspaceEdit>>,
) => result.fileCount
    ? textResult(
      `${label} · ${result.fileCount} ${result.fileCount === 1 ? "file" : "files"} · ${result.editCount} ${result.editCount === 1 ? "edit" : "edits"}\n\n${result.patch}`,
    )
    : textResult("");

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

  server.registerTool(
    "code_actions",
    {
      title: "Code actions",
      description:
        "List code actions for a range, or set action to a displayed number to resolve it and return its Codex patch. The MCP does not modify files.",
      inputSchema: input.CodeActions,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, range, only, action }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const report = await workspace.sendRequest(
        DocumentDiagnosticRequest.type,
        { textDocument },
        signal,
      );
      const diagnostics = report?.kind === "full"
        ? report.items.filter((diagnostic) => diagnosticIntersects(diagnostic, range))
        : [];
      const actions = await workspace.sendRequest(
        CodeActionRequest.type,
        {
          textDocument,
          range,
          context: {
            diagnostics,
            ...(only ? { only: [only] } : {}),
            triggerKind: CodeActionTriggerKind.Invoked,
          },
        },
        signal,
      ) ?? [];
      if (action === undefined) {
        return textResult(actions.map((item, index) => {
          const command = Command.is(item);
          const kind = command ? " [editor command]" : item.kind ? ` [${item.kind}]` : "";
          const disabled = !command && item.disabled
            ? ` — unavailable: ${item.disabled.reason}`
            : "";
          return `${index + 1}. ${item.title}${kind}${disabled}`;
        }).join("\n"));
      }
      const selected = actions[action - 1];
      if (!selected) throw new Error(`Code action ${action} is not available.`);
      if (Command.is(selected)) {
        throw new Error(`Code action ${action} is an editor command, not a workspace edit.`);
      }
      const resolved = selected.data === undefined
        ? selected
        : await workspace.sendRequest(CodeActionResolveRequest.type, selected, signal);
      if (resolved.disabled) throw new Error(resolved.disabled.reason);
      if (resolved.command) {
        throw new Error(
          `Code action ${action} requires the editor command ${resolved.command.command}.`,
        );
      }
      if (!resolved.edit) return textResult("");
      return formatPatchResult(
        resolved.title,
        await renderWorkspaceEdit(workspace, root, resolved.edit),
      );
    },
  );
};
