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
import { formatFoldedSource } from "@featuretype/code-intelligence/folded-source";
import { readOnlyToolAnnotations } from "./metadata.ts";
import {
  formatDiagnostics,
  formatDocumentSymbols,
  formatProjectConfig,
  workspacePath,
} from "@featuretype/code-intelligence/text";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { fileInput, observedFileInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@featuretype/code-intelligence";

const readFileTarget = type({
  path: "string >= 1",
  "fold?": "boolean",
  "startLine?": "number.integer >= 1",
  "endLine?": "number.integer >= 1",
}).onUndeclaredKey("reject");

const input = type.module({
  File: type(fileInput).onUndeclaredKey("reject"),
  ReadFile: type({
    workspace: fileInput.workspace,
    file: type("string >= 1").or(
      type("string >= 1").or(readFileTarget).array().atLeastLength(1),
    ).describe("A file path, or file views to read together."),
    includeDiagnostics: type("boolean")
      .describe("Include actionable diagnostics from each queried file when present.")
      .default(true),
    fold: type("boolean")
      .describe("Default folding behavior for file views that do not override it.")
      .default(true),
    "startLine?": type("number.integer >= 1")
      .describe("Default first 1-based source line for file views."),
    "endLine?": type("number.integer >= 1")
      .describe("Default last inclusive 1-based source line for file views."),
  }).onUndeclaredKey("reject"),
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
    "read_file",
    {
      title: "Read files",
      description:
        "Read source from one or more files with stable line numbers. Array entries may be paths or { path, startLine, endLine, fold } views. Folding is enabled by default.",
      inputSchema: input.ReadFile,
      annotations: readOnlyToolAnnotations,
    },
    async (request, { mcpReq: { signal } }) => {
      const {
        workspace: root,
        fold,
        startLine,
        endLine,
        includeDiagnostics,
      } = request;
      const files = Array.isArray(request.file) ? request.file : [request.file];
      const workspace = await workspaces.get(root);
      const intelligence = createCodeIntelligence(workspace);
      const sections = await Promise.all(files.map(async (entry) => {
        const target = typeof entry === "string" ? { path: entry } : entry;
        const file = target.path;
        const targetStartLine = target.startLine ?? startLine;
        const targetEndLine = target.endLine ?? endLine;
        const targetFold = target.fold ?? fold;
        try {
          if (
            targetStartLine !== undefined &&
            targetEndLine !== undefined &&
            targetStartLine > targetEndLine
          ) {
            throw new Error("startLine must be less than or equal to endLine.");
          }
          const { textDocument, source, foldingRanges } =
            await intelligence.readSource(file, targetFold, signal);
          const diagnosticContext = requestDiagnosticContext(
            workspace,
            textDocument,
            root,
            includeDiagnostics,
            signal,
          );
          const context = await diagnosticContext;
          const text = formatFoldedSource(source, foldingRanges, {
            startLine: targetStartLine,
            endLine: targetEndLine,
          });
          return {
            file: workspacePath(textDocument.uri, root),
            text: context ? `${text}\n\n${context}` : text,
          };
        } catch (error) {
          signal.throwIfAborted();
          if (files.length === 1) throw error;
          return {
            file,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }));
      return textResult(
        sections.length === 1
          ? sections[0]?.text ?? ""
          : sections.map(({ file, text }) => `== ${file} ==\n${text}`).join("\n\n"),
      );
    },
  );

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
