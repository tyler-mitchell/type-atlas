import { type } from "arktype";

const position = type({
  line: type("number.integer >= 0").describe("Zero-based source line."),
  character: type("number.integer >= 0").describe(
    "Zero-based UTF-16 character.",
  ),
}).onUndeclaredKey("reject");

const fileView = type({
  path: "string >= 1",
  "fold?": "boolean",
  "startLine?": "number.integer >= 1",
  "endLine?": "number.integer >= 1",
}).onUndeclaredKey("reject");

const inspectOptions = {
  file: "string >= 1",
  includeDiagnostics: type("boolean").default(true),
  includeSource: type("boolean").default(false),
  includeTypeDefinitions: type("boolean").default(false),
  limit: "1 <= number.integer <= 100 = 20",
} as const;

export const input = type.module({
  ReadFile: type({
    file: type("string >= 1").or(fileView).or(
      fileView.array().atLeastLength(1),
    ),
    fold: type("boolean").default(true),
    includeDiagnostics: type("boolean").default(true),
  }).onUndeclaredKey("reject"),
  Diagnostics: type({
    "file?": type("string >= 1").or(
      type("string >= 1").array().atLeastLength(1),
    ),
  }).onUndeclaredKey("reject"),
  DocumentSymbols: type({
    file: "string >= 1",
    depth: "0 <= number.integer <= 10 = 0",
    includeDiagnostics: type("boolean").default(true),
  }).onUndeclaredKey("reject"),
  Position: type({
    file: "string >= 1",
    position,
    includeDiagnostics: type("boolean").default(true),
  }).onUndeclaredKey("reject"),
  References: type({
    file: "string >= 1",
    position,
    includeDeclaration: type("boolean").default(true),
    offset: "number.integer >= 0 = 0",
    limit: "1 <= number.integer <= 100 = 20",
    includeDiagnostics: type("boolean").default(true),
  }).onUndeclaredKey("reject"),
  WorkspaceSymbols: type({
    file: "string >= 1",
    query: "string >= 1",
    offset: "number.integer >= 0 = 0",
    limit: "1 <= number.integer <= 100 = 10",
  }).onUndeclaredKey("reject"),
  InspectSymbol: type({
    ...inspectOptions,
    position,
  }).onUndeclaredKey("reject").or(type({
    ...inspectOptions,
    symbol: "string >= 1",
  }).onUndeclaredKey("reject")),
});

const tool = <Schema extends { toJsonSchema(): object }>(
  name: string,
  description: string,
  schema: Schema,
) => ({
  type: "function" as const,
  name,
  description,
  inputSchema: schema.toJsonSchema(),
});

export const namespace = {
  type: "namespace" as const,
  name: "code_intelligence",
  description:
    "Code intelligence bound to the current Codex task and workspace.",
  tools: [
    tool(
      "inspect_symbol",
      "Return an agent-ready symbol view with exact ranges, relationships, remaining references, project scope, and optional source. Select by exact file-local name or source position.",
      input.InspectSymbol,
    ),
    tool(
      "read_file",
      "Read UTF-8 source, Markdown, and JSON from this task's workspace with line numbers and native folding. Pass a path or ranged view, or an array of either.",
      input.ReadFile,
    ),
    tool(
      "diagnostics",
      "Return diagnostics for files. Omit file to check source files changed by this Codex task; clean results return no text.",
      input.Diagnostics,
    ),
    tool(
      "document_symbols",
      "Return a file outline and exact source ranges.",
      input.DocumentSymbols,
    ),
    tool("hover", "Return type and documentation at a position.", input.Position),
    tool("definitions", "Return definitions at a position.", input.Position),
    tool(
      "references",
      "Return a bounded page of references at a position.",
      input.References,
    ),
    tool(
      "workspace_symbols",
      "Search the TypeScript project selected by a source file. Avoid broad or repeated speculative searches in large monorepos.",
      input.WorkspaceSymbols,
    ),
  ],
};
