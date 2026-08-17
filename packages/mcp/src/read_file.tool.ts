import { readSourceView, type VolarWorkspacePool } from "@type-atlas/core";
import { formatFoldedSource } from "@type-atlas/core/folded-source";
import { workspacePath } from "@type-atlas/core/text";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { registerTool } from "./tool.ts";
import { fileInput } from "./tool-input.ts";

/**
 * One entry of the batch: a path, or a path carrying its own window.
 *
 * The choice sits under `items`, so the array still publishes `type: "array"`
 * and every entry survives transport as the JSON value it is.
 */
const entry = type({
  path: type("string >= 1").describe("Workspace-relative or absolute file path."),
  "startLine?": type("number.integer >= 1").describe("First 1-based line for this path."),
  "endLine?": type("number.integer >= 1").describe("Last inclusive 1-based line for this path."),
  "fold?": type("boolean").describe("Folding for this path."),
});

const input = type({
  workspace: fileInput.workspace,
  file: type("string >= 1")
    .or(entry)
    .array()
    .atLeastLength(1)
    .atMostLength(50)
    .describe(
      'One or more files to read together: a path, or { path, startLine, endLine, fold } to bound a single file. Mixing both is allowed, as in ["a.ts", { "path": "b.ts", "startLine": 1, "endLine": 40 }].',
    ),
  "fold?": type("boolean").configure({
    default: true,
    description: "Fold function bodies to their signatures, for entries that do not set their own.",
  }),
  "startLine?": type("number.integer >= 1").configure({
    description: "First 1-based source line, for entries that do not set their own.",
  }),
  "endLine?": type("number.integer >= 1").configure({
    description: "Last inclusive 1-based source line, for entries that do not set their own.",
  }),
});

/** Each entry under the call's defaults, as one shape. */
const targets = (request: typeof input.infer) =>
  request.file.map((value) => {
    const view = typeof value === "string" ? { path: value } : value;
    return {
      file: view.path,
      fold: view.fold ?? request.fold ?? true,
      window: {
        startLine: view.startLine ?? request.startLine,
        endLine: view.endLine ?? request.endLine,
      },
    };
  });

export const registerReadFileTool = (server: McpServer, workspaces: VolarWorkspacePool): void => {
  registerTool(
    server,
    "read_file",
    {
      title: "Read files",
      description:
        "Read one or more UTF-8 text files, including source, Markdown, and JSON, with stable line numbers. Pass every path in one call rather than calling repeatedly. Function bodies fold to their signatures by default; startLine, endLine, and fold apply to every path in the call.",
      inputSchema: input,
      annotations: readOnlyToolAnnotations,
    },
    async (request, { mcpReq: { signal } }) => {
      const root = request.workspace;
      const workspace = await workspaces.get(root);
      const read = targets(request);
      const sections = await Promise.all(
        read.map(async (target) => {
          try {
            const view = await readSourceView({ workspace, ...target, signal });
            return {
              file: workspacePath(view.uri, root),
              text: formatFoldedSource(view.lines, view.foldingRanges, target.window),
            };
          } catch (error) {
            signal.throwIfAborted();
            if (read.length === 1) throw error;
            return {
              file: target.file,
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
