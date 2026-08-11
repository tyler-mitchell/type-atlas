import { createTypeAtlas, type VolarWorkspacePool } from "@type-atlas/core";
import { formatFoldedSource } from "@type-atlas/core/folded-source";
import { workspacePath } from "@type-atlas/core/text";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { URI } from "vscode-uri";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { registerTool } from "./tool.ts";
import { diagnosticModeInput, fileInput } from "./tool-input.ts";

const maxFileBytes = 16 * 1024 * 1024;
const maxBatchBytes = 32 * 1024 * 1024;
const maxLargeFileLines = 10_000;

const readFileTarget = type({
  path: "string >= 1",
  "fold?": "boolean",
  "startLine?": "number.integer >= 1",
  "endLine?": "number.integer >= 1",
}).onUndeclaredKey("reject");

/**
 * Reads a file entry that arrived as text.
 *
 * `file` accepts a path or a `{ path, startLine, endLine, fold }` view, and a
 * caller reconstructing that union sometimes sends the view JSON-encoded. A
 * path never parses as a JSON object, so recovering one costs nothing and
 * turns a request that would resolve to a nonexistent encoded path into the
 * read that was meant.
 */
const asFileView = (entry: string) => {
  if (!entry.startsWith("{")) return { path: entry };
  const decoded = readFileTarget(JSON.parse(entry) as unknown);
  if (decoded instanceof type.errors) {
    throw new Error(`file must be a path or a { path, startLine, endLine, fold } view: ${entry}`);
  }
  return decoded;
};

const readFileInput = type({
  workspace: fileInput.workspace,
  file: type("string >= 1")
    .or(readFileTarget)
    .or(type("string >= 1").or(readFileTarget).array().atLeastLength(1).atMostLength(50))
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

const readFileRange = async ({
  uri,
  startLine,
  endLine,
  signal,
}: {
  readonly uri: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly signal: AbortSignal;
}): Promise<string> => {
  const parsed = URI.parse(uri);
  if (parsed.scheme !== "file") throw new Error(`Ranged source is not a file: ${uri}`);
  const stream = createReadStream(parsed.fsPath, { encoding: "utf8", signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const source: string[] = [];
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (lineNumber >= startLine) source.push(line);
      if (lineNumber >= endLine) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return source.join("\n");
};

export const registerReadFileTool = (server: McpServer, workspaces: VolarWorkspacePool): void => {
  registerTool(
    server,
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
      const typeAtlas = createTypeAtlas(workspace);
      const targets = files.map((entry) => {
        const target = typeof entry === "string" ? asFileView(entry) : entry;
        const targetStartLine = target.startLine ?? startLine;
        const targetEndLine = target.endLine ?? endLine;
        if (
          targetStartLine !== undefined &&
          targetEndLine !== undefined &&
          targetStartLine > targetEndLine
        ) {
          throw new Error("startLine must be less than or equal to endLine.");
        }
        return {
          file: target.path,
          startLine: targetStartLine,
          endLine: targetEndLine,
          fold: target.fold ?? fold,
        };
      });
      const sizes = await typeAtlas.sourceSizes(
        targets.map(({ file }) => file),
        signal,
      );
      const views = targets.map((target, index) => ({ ...target, size: sizes[index] ?? null }));
      const batchBytes = views.reduce(
        (total, { size }) => total + (size !== null && size <= maxFileBytes ? size : 0),
        0,
      );
      if (batchBytes > maxBatchBytes) {
        throw new Error(
          `Broad read is ${(batchBytes / 1024 / 1024).toFixed(1)} MiB across ${views.length} files; the per-call limit is ${maxBatchBytes / 1024 / 1024} MiB. Split the request into smaller batches.`,
        );
      }
      const sections = await Promise.all(
        views.map(async (target) => {
          try {
            const size = target.size;
            const oversized = size !== null && size > maxFileBytes;
            const boundedLineCount =
              target.startLine !== undefined && target.endLine !== undefined
                ? target.endLine - target.startLine + 1
                : undefined;
            const readLargeRange =
              oversized && boundedLineCount !== undefined && boundedLineCount <= maxLargeFileLines;
            if (oversized && !readLargeRange) {
              throw new Error(
                `${target.file} is ${(size / 1024 / 1024).toFixed(1)} MiB; broad reads are limited to ${maxFileBytes / 1024 / 1024} MiB. Pass { path, startLine, endLine } with at most ${maxLargeFileLines.toLocaleString()} lines.`,
              );
            }
            if (readLargeRange) {
              const uri = workspace.getWorkspaceUri(target.file);
              const source = await readFileRange({
                uri,
                startLine: target.startLine!,
                endLine: target.endLine!,
                signal,
              });
              return {
                file: workspacePath(uri, root),
                text: formatFoldedSource(source, [], { sourceStartLine: target.startLine }),
              };
            }
            const { textDocument, source, foldingRanges } = await typeAtlas.readSource(
              target.file,
              target.fold,
              signal,
            );
            const context = await requestDiagnosticContext(
              workspace,
              textDocument,
              root,
              includeDiagnostics,
              signal,
            );
            const text = formatFoldedSource(source, foldingRanges, {
              startLine: target.startLine,
              endLine: target.endLine,
            });
            return {
              file: workspacePath(textDocument.uri, root),
              text: context ? `${text}\n\n${context}` : text,
            };
          } catch (error) {
            signal.throwIfAborted();
            if (files.length === 1) throw error;
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
