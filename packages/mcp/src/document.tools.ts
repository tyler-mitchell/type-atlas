import { GetMatchTsConfigRequest } from "@volar/language-server/protocol.js";
import { createTypeAtlas, page, projectDocumentSymbols } from "@type-atlas/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import {
  formatDiagnostics,
  formatDocumentLinks,
  formatDocumentSymbols,
  formatProjectConfig,
  formatProjectDiagnostics,
  formatSelectionRanges,
} from "@type-atlas/core/text";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { registerTool } from "./tool.ts";
import { fileInput, observedFileInput, positionsInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@type-atlas/core";

const input = type.module({
  Diagnostics: type({
    ...fileInput,
    "scope?": type.enumerated("file", "project").configure(
      {
        default: "project",
        description:
          "One of: project (the TypeScript project selected by this file, the default), file (that file alone).",
      },
      "self",
    ),
    "offset?": type("number.integer >= 0").configure({
      description: "First project diagnostic returned; applies only to project scope.",
    }),
    "limit?": type("1 <= number.integer <= 1000").configure({
      default: 100,
      description: "Maximum project diagnostics returned; applies only to project scope.",
    }),
  }),
  File: type(fileInput),
  DocumentLinks: type(observedFileInput),
  DocumentSymbols: type({
    ...observedFileInput,
    "depth?": type("0 <= number.integer <= 10").configure({
      description:
        "Levels of nested symbols to include. Defaults to top-level declarations only, which is usually what an agent wants.",
    }),
    "raw?": type("boolean").configure({
      description:
        "Return the complete symbol hierarchy, including object properties and anonymous callbacks. Potentially far larger than the source file.",
    }),
  }),
  SelectionRanges: type({
    ...observedFileInput,
    position: positionsInput.configure(
      { description: "One or more source positions to inspect together." },
      "self",
    ),
  }),
});

export const registerDocumentTools = (server: McpServer, workspaces: VolarWorkspacePool): void => {
  registerTool(
    server,
    "diagnostics",
    {
      title: "Diagnostics",
      description:
        "Return a bounded diagnostic page for the exact TypeScript project selected by file. Normal file tools already surface complete ambient errors and warnings; use file scope only when deliberately requesting every diagnostic for one file. A clean report returns no content.",
      inputSchema: input.Diagnostics,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, scope = "project", offset = 0, limit = 100 },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      if (scope === "file") {
        const { textDocument, report } = await intelligence.diagnostics(file, signal);
        return textResult(formatDiagnostics(textDocument.uri, report, root));
      }

      const { project } = await intelligence.projectDiagnostics(file, signal);
      const diagnostics =
        project?.documents.flatMap(({ uri, diagnostics }) =>
          diagnostics.map((diagnostic) => ({ uri, diagnostic })),
        ) ?? [];
      const prioritized = [...diagnostics].sort(
        (left, right) =>
          (left.diagnostic.severity ?? Number.POSITIVE_INFINITY) -
          (right.diagnostic.severity ?? Number.POSITIVE_INFINITY),
      );
      return textResult(
        formatProjectDiagnostics(
          project?.configFile ?? null,
          project?.fileCount ?? 0,
          project?.documents.length ?? 0,
          page(prioritized, offset, limit),
          root,
        ),
      );
    },
  );

  registerTool(
    server,
    "document_links",
    {
      title: "Document links",
      description:
        "Return resolved links discovered by the active language service in a Markdown or JSON document.",
      inputSchema: input.DocumentLinks,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      const { textDocument, links } = await intelligence.documentLinks(file, signal);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      return appendDiagnosticContext(
        textResult(formatDocumentLinks(textDocument.uri, links, root)),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "document_symbols",
    {
      title: "Document symbols",
      description:
        "Return the top-level document outline and source ranges. Set depth to include nested symbols or raw to return the complete hierarchy.",
      inputSchema: input.DocumentSymbols,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, depth = 0, raw = false, includeDiagnostics },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      const { textDocument, symbols } = await intelligence.documentSymbols(file, signal);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      const output = raw || symbols === null ? symbols : projectDocumentSymbols(symbols, depth);
      return appendDiagnosticContext(
        textResult(formatDocumentSymbols(textDocument.uri, output, root)),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "selection_ranges",
    {
      title: "Selection ranges",
      description:
        "Return the nested structural ranges an editor expands through from one or more source positions.",
      inputSchema: input.SelectionRanges,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const positions = Array.isArray(position) ? position : [position];
      const intelligence = createTypeAtlas(workspace);
      const { textDocument, ranges } = await intelligence.selectionRanges(file, positions, signal);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      return appendDiagnosticContext(
        textResult(formatSelectionRanges(textDocument.uri, positions, ranges, root)),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "project_config",
    {
      title: "Project configuration",
      description: "Return the TypeScript configuration selected for a source file.",
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
