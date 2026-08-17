import { GetMatchTsConfigRequest } from "@volar/language-server/protocol.js";
import { createTypeAtlas, projectDocumentSymbols } from "@type-atlas/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import {
  formatDiagnose,
  formatDocumentLinks,
  formatDocumentSymbols,
  formatProjectConfig,
  formatSelectionRanges,
} from "@type-atlas/core/text";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { registerTool } from "./tool.ts";
import { fileInput, observedFileInput, positionsInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@type-atlas/core";

const input = type.module({
  Diagnostics: type({
    workspace: fileInput.workspace,
    "project?": type("string >= 1").configure({
      description:
        "Which TypeScript project to check, named by its directory or by any path inside it — this never reports on one file. Only needed when nothing has changed yet; the changed files choose the project otherwise.",
    }),
    "scope?": type.enumerated("changed", "project").configure(
      {
        default: "changed",
        description:
          "changed (files written since this workspace opened, the default) or project (every file in the projects owning them).",
      },
      "self",
    ),
    "offset?": type("number.integer >= 0").configure({
      description: "First diagnostic returned.",
    }),
    "limit?": type("1 <= number.integer <= 1000").configure({
      default: 100,
      description: "Maximum diagnostics returned.",
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
        "Report diagnostics for the TypeScript projects you have touched — the compiler's own whole-program check, run once per project.",
      inputSchema: input.Diagnostics,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, project: named, scope = "changed", offset = 0, limit = 100 },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      return textResult(
        formatDiagnose({
          report: await createTypeAtlas(workspace).diagnose({
            files: named ? [named] : workspace.changedFiles(),
            scope,
            signal,
          }),
          scope,
          page: { offset, limit },
          root,
        }),
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
      const { textDocument, result: symbols } = await intelligence.documentSymbols({ file, signal });
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
      const { textDocument, result: ranges } = await intelligence.selectionRanges({
        file,
        signal,
        params: { positions: [...positions] },
      });
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
