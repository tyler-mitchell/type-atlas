import { createTypeAtlas, type VolarWorkspacePool } from "@typeatlas/core";
import { formatFoldedSource } from "@typeatlas/core/folded-source";
import { workspacePath } from "@typeatlas/core/text";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { diagnosticModeInput, fileInput } from "./tool-input.ts";

const readFileTarget = type({
  path: "string >= 1",
  "fold?": "boolean",
  "startLine?": "number.integer >= 1",
  "endLine?": "number.integer >= 1",
}).onUndeclaredKey("reject");

const readFileInput = type({
  workspace: fileInput.workspace,
  file: type("string >= 1")
    .or(readFileTarget)
    .or(type("string >= 1").or(readFileTarget).array().atLeastLength(1))
    .configure({ description: "A file path, or file views to read together." }),
  "includeDiagnostics?": diagnosticModeInput,
  "fold?": type("boolean").configure({
    default: true,
    description: "Default folding behavior for file views that do not override it.",
  }),
  "startLine?": type("number.integer >= 1").configure({
    description: "Default first 1-based source line for file views.",
  }),
  "endLine?": type("number.integer >= 1").configure({
    description: "Default last inclusive 1-based source line for file views.",
  }),
}).onUndeclaredKey("reject");

export const registerReadFileTool = (server: McpServer, workspaces: VolarWorkspacePool): void => {
  server.registerTool(
    "read_file",
    {
      title: "Read files",
      description:
        "Read one or more UTF-8 text files, including source, Markdown, and JSON, with stable line numbers. Pass a path or { path, startLine, endLine, fold } view, or an array of either. Native folding is used when available.",
      inputSchema: readFileInput,
      annotations: readOnlyToolAnnotations,
    },
    async (request, { mcpReq: { signal } }) => {
      const {
        workspace: root,
        fold = true,
        startLine,
        endLine,
        includeDiagnostics = true,
      } = request;
      const files = Array.isArray(request.file) ? request.file : [request.file];
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      const sections = await Promise.all(
        files.map(async (entry) => {
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
            const { textDocument, source, foldingRanges } = await intelligence.readSource(
              file,
              targetFold,
              signal,
            );
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
        }),
      );
      return textResult(
        sections.length === 1
          ? (sections[0]?.text ?? "")
          : sections.map(({ file, text }) => `== ${file} ==\n${text}`).join("\n\n"),
      );
    },
  );
};
