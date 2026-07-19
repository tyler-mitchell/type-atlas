import {
  GetMatchTsConfigRequest,
} from "@volar/language-server/protocol.js";
import {
  createCodeIntelligence,
  projectDocumentSymbols,
} from "@featuretype/code-intelligence";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import {
  formatDiagnostics,
  formatDocumentSymbols,
  formatProjectConfig,
} from "@featuretype/code-intelligence/text";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { fileInput, observedFileInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@featuretype/code-intelligence";

const input = type.module({
  File: type(fileInput).onUndeclaredKey("reject"),
  DocumentSymbols: type({
    ...observedFileInput,
    "depth?": "0 <= number.integer <= 10",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
});

export const registerDocumentTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): void => {
  server.registerTool(
    "diagnostics",
    {
      title: "Diagnostics",
      description:
        "Return the full diagnostic report for a file. File-scoped tools already surface ambient errors and warnings; use this only to expand that notice or deliberately inspect diagnostics. A clean report returns no content.",
      inputSchema: input.File,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, report } = await createCodeIntelligence(workspace)
        .diagnostics(file, signal);
      return textResult(formatDiagnostics(textDocument.uri, report, root));
    },
  );

  server.registerTool(
    "document_symbols",
    {
      title: "Document symbols",
      description:
        "Return the top-level document outline and source ranges. Set depth to include nested symbols or raw to return the complete hierarchy.",
      inputSchema: input.DocumentSymbols,
      annotations: readOnlyToolAnnotations,
    },
    async ({
      workspace: root,
      file,
      depth = 0,
      raw = false,
      includeDiagnostics,
    }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const intelligence = createCodeIntelligence(workspace);
      const { textDocument, symbols } = await intelligence.documentSymbols(
        file,
        signal,
      );
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      const output = raw || symbols === null
        ? symbols
        : projectDocumentSymbols(symbols, depth);
      return appendDiagnosticContext(
        textResult(formatDocumentSymbols(textDocument.uri, output, root)),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "project_config",
    {
      title: "Project configuration",
      description:
        "Return the TypeScript configuration selected for a source file.",
      inputSchema: input.File,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const result = await workspace.sendRequest(
        GetMatchTsConfigRequest.type,
        textDocument,
        signal,
      );
      return textResult(formatProjectConfig(result, root));
    },
  );
};
