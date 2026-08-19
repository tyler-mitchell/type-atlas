import { readSourceView, renderDocument, type VolarWorkspacePool } from "@type-atlas/core";
import { foldedSource, displayPath } from "atlascii";
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

/**
 * Where a view's window actually ends: the requested end, the file's end, or
 * the answer bound, whichever comes first.
 *
 * The bound exists because a 91.7KB answer was once produced in one call and
 * the client refused to deliver it — an unbounded answer's fate is decided by
 * whoever is listening. Roughly 10k tokens of source per file, cut at a line.
 */
const answerLines = 600;
const answerCharacters = 40_000;
const servedEnd = (
  lines: readonly string[],
  from: number,
  requestedEnd: number,
  characterBudget: number,
) => {
  const end = Math.min(requestedEnd, lines.length, from + answerLines - 1);
  const counted = lines.slice(from - 1, end).reduce(
    (walk, line) =>
      walk.characters > characterBudget
        ? walk
        : { at: walk.at + 1, characters: walk.characters + line.length + 1 },
    { at: from - 1, characters: 0 },
  );
  return Math.max(counted.at, from);
};

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
      // The budget is the answer's, not each file's: two capped views once
      // still summed past what a client would deliver.
      const characterBudget = Math.max(8_000, Math.floor(answerCharacters / read.length));
      const views = await Promise.all(
        read.map(async (target) => {
          try {
            const view = await readSourceView({ workspace, ...target, signal });
            const from = target.window.startLine ?? 1;
            // Clamped to the file: a header that echoes a request past the end
            // claims lines the answer never held.
            const requestedEnd = Math.min(
              target.window.endLine ?? view.lines.length,
              view.lines.length,
            );
            const end = servedEnd(view.lines, from, requestedEnd, characterBudget);
            const bounded = end < requestedEnd;
            // Measured here, rendered by the document: the heading has to say
            // how much was folded, and only folding knows that. The document
            // asks for the same source again to show it.
            const measured = foldedSource({
              lines: view.lines,
              ranges: view.foldingRanges,
              window: bounded ? { startLine: from, endLine: end } : target.window,
            });
            const shown = measured.text === "" ? 0 : measured.text.split("\n").length;
            const windowed =
              bounded ||
              target.window.startLine !== undefined ||
              target.window.endLine !== undefined;
            return {
              file: displayPath(view.uri, root),
              lines: view.lines,
              foldingRanges: view.foldingRanges,
              lineCount: view.lines.length,
              windowed,
              startLine: windowed ? from : target.window.startLine,
              endLine: end,
              next: bounded ? end + 1 : undefined,
              folded: measured.folded,
              shownLines: shown,
            };
          } catch (error) {
            signal.throwIfAborted();
            if (read.length === 1) throw error;
            return {
              file: target.file,
              error: `Error: ${error instanceof Error ? error.message : String(error)}`,
              folded: 0,
              shownLines: 0,
            };
          }
        }),
      );
      const rendered = await renderDocument({
        document: "read-file.tool.mdoc",
        variables: {
          root,
          views,
          single: views.length === 1,
          only: views[0],
          count: views.length,
          folded: views.reduce((total, view) => total + view.folded, 0),
          // What is on screen, not what the files hold: summing whole files
          // above a set of windows states a number the reader was never shown.
          shownLines: views.reduce((total, view) => total + view.shownLines, 0),
        },
      });
      return textResult(rendered.text);
    },
  );
};
