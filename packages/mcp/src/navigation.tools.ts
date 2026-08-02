import {
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  DocumentHighlightRequest,
  FindFileReferenceRequest,
  GetMatchTsConfigRequest,
  HoverRequest,
  ImplementationRequest,
  type SymbolInformation,
  TypeDefinitionRequest,
  type WorkspaceSymbol,
} from "@volar/language-server/protocol.js";
import { createTypeAtlas, inspectSymbol, page } from "@typeatlas/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import {
  formatCallHierarchy,
  formatDocumentHighlights,
  formatLocationPage,
  formatNavigation,
  formatPositionQuery,
  formatProjectScope,
  formatWorkspaceSymbolScope,
  formatWorkspaceSymbols,
} from "@typeatlas/core/text";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { registerTool } from "./tool.ts";
import { fileInput, observedFileInput, positionInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@typeatlas/core";

const inspectOptions = {
  ...observedFileInput,
  "compactExternalCalls?": type("boolean").configure({
    default: true,
    description:
      "Summarize dependency and JavaScript runtime call targets while workspace calls retain exact ranges. Pass false for complete external call details.",
  }),
  includeSource: type("boolean").describe("Include the complete symbol body.").default(false),
  includeTypeDefinitions: type("boolean")
    .describe("Include callable type-definition targets.")
    .default(false),
  limit: type("1 <= number.integer <= 100")
    .describe("Maximum callers, callees, references, and ambiguity candidates shown per section.")
    .default(20),
} as const;

const input = type.module({
  Position: type({
    ...observedFileInput,
    position: positionInput,
  }).onUndeclaredKey("reject"),
  References: type({
    ...observedFileInput,
    position: positionInput,
    "includeDeclaration?": "boolean",
    "offset?": "number.integer >= 0",
    "limit?": "1 <= number.integer <= 100",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  FileReferences: type({
    ...observedFileInput,
    "offset?": "number.integer >= 0",
    "limit?": "1 <= number.integer <= 100",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  WorkspaceSymbols: type({
    ...fileInput,
    query: type("string").describe(
      "Use a specific symbol name; avoid broad speculative queries in large workspaces.",
    ),
    "offset?": "number.integer >= 0",
    "limit?": type("1 <= number.integer <= 100").describe(
      "Maximum results returned; this does not reduce the underlying workspace search.",
    ),
    "raw?": type("boolean").describe(
      "Return every matching symbol; potentially very large in monorepos.",
    ),
  }).onUndeclaredKey("reject"),
  InspectSymbol: type({
    ...inspectOptions,
    position: positionInput,
  })
    .onUndeclaredKey("reject")
    .or(
      type({
        ...inspectOptions,
        symbol: type("string >= 1").describe(
          "Exact document-symbol name in the file. Ambiguous matches are returned as candidates.",
        ),
      }).onUndeclaredKey("reject"),
    ),
});

export const registerNavigationTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): void => {
  registerTool(
    server,
    "inspect_symbol",
    {
      title: "Inspect symbol",
      description:
        "Return a bounded working view of a symbol: type and documentation, exact definition/body ranges, distinct implementations and types, callers, direct calls, remaining references, project scope, and optional source. Select by exact file-local symbol name or source position.",
      inputSchema: input.InspectSymbol,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        file,
        includeDiagnostics,
        compactExternalCalls = true,
        includeSource = false,
        includeTypeDefinitions = false,
        limit = 20,
        ...target
      },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const result = await inspectSymbol(
        workspace,
        root,
        file,
        "symbol" in target ? { symbol: target.symbol } : { position: target.position },
        { compactExternalCalls, includeSource, includeTypeDefinitions, limit },
        signal,
      );
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        result.textDocument,
        root,
        includeDiagnostics,
        signal,
        result.position,
      );
      return appendDiagnosticContext(textResult(result.text), await diagnosticContext);
    },
  );

  registerTool(
    server,
    "workspace_symbols",
    {
      title: "Workspace symbols",
      description:
        "Search symbols across TypeScript projects activated in this workspace session. Potentially expensive in large monorepos: each call may search many project files, and limit only bounds returned output. Use document_symbols when the file is known; avoid parallel or repeated speculative searches.",
      inputSchema: input.WorkspaceSymbols,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, query, offset = 0, limit = 10, raw = false },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const { project, symbols } = await createTypeAtlas(workspace).workspaceSymbols(
        file,
        query,
        signal,
      );
      const output =
        symbols === null
          ? null
          : raw
            ? page<SymbolInformation | WorkspaceSymbol>(symbols, 0, symbols.length)
            : page<SymbolInformation | WorkspaceSymbol>(symbols, offset, limit);
      return textResult(
        [formatWorkspaceSymbolScope(project, root), formatWorkspaceSymbols(output, root)].join(
          "\n",
        ),
      );
    },
  );

  registerTool(
    server,
    "definitions",
    {
      title: "Definitions",
      description: "Return definition locations at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, definitions } = await createTypeAtlas(workspace).definitions(
        file,
        position,
        signal,
      );
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      return appendDiagnosticContext(
        textResult(formatNavigation("definitions", definitions, root)),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "type_definitions",
    {
      title: "Type definitions",
      description: "Return type-definition locations at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      const result = await workspace.sendRequest(
        TypeDefinitionRequest.type,
        { textDocument, position },
        signal,
      );
      return appendDiagnosticContext(
        textResult(formatNavigation("type definitions", result, root)),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "implementations",
    {
      title: "Implementations",
      description: "Return implementation locations at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      const result = await workspace.sendRequest(
        ImplementationRequest.type,
        { textDocument, position },
        signal,
      );
      return appendDiagnosticContext(
        textResult(formatNavigation("implementations", result, root)),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "callers",
    {
      title: "Callers",
      description:
        "Show which functions call the callable symbol at a position, grouped by caller with exact call sites. Use this instead of references when tracing incoming execution flow.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      const { items, incomingCalls } = await workspace.runResolverSequence(async () => {
        const items = await workspace.sendRequest(
          CallHierarchyPrepareRequest.type,
          { textDocument, position },
          signal,
        );
        return {
          items,
          incomingCalls:
            items === null
              ? null
              : await Promise.all(
                  items.map((item) =>
                    workspace.sendRequest(CallHierarchyIncomingCallsRequest.type, { item }, signal),
                  ),
                ),
        };
      }, signal);
      return appendDiagnosticContext(
        textResult(
          formatCallHierarchy(
            "incoming",
            {
              prepareCallHierarchy: items,
              incomingCalls,
            },
            root,
          ),
        ),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "callees",
    {
      title: "Callees",
      description:
        "Show which callable symbols are invoked directly by the function at a position, grouped with exact call sites. Use this instead of references when tracing outgoing execution flow.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      const { items, outgoingCalls } = await workspace.runResolverSequence(async () => {
        const items = await workspace.sendRequest(
          CallHierarchyPrepareRequest.type,
          { textDocument, position },
          signal,
        );
        return {
          items,
          outgoingCalls:
            items === null
              ? null
              : await Promise.all(
                  items.map((item) =>
                    workspace.sendRequest(CallHierarchyOutgoingCallsRequest.type, { item }, signal),
                  ),
                ),
        };
      }, signal);
      return appendDiagnosticContext(
        textResult(
          formatCallHierarchy(
            "outgoing",
            {
              prepareCallHierarchy: items,
              outgoingCalls,
            },
            root,
          ),
        ),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "references",
    {
      title: "References",
      description:
        "Return a bounded page of reference locations from the TypeScript project selected by file. Set raw to return every project-scoped reference.",
      inputSchema: input.References,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        file,
        position,
        includeDeclaration = true,
        offset = 0,
        limit = 20,
        raw = false,
        includeDiagnostics,
      },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      const { textDocument, references } = await intelligence.references(
        file,
        position,
        includeDeclaration,
        signal,
      );
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      const project = workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal);
      const query = workspace.sendRequest(HoverRequest.type, { textDocument, position }, signal);
      const output =
        references === null
          ? null
          : raw
            ? page(references, 0, references.length)
            : page(references, offset, limit);
      return appendDiagnosticContext(
        textResult(
          [
            formatProjectScope(await project, root),
            formatPositionQuery(textDocument.uri, position, await query, root),
            formatLocationPage("references", output, root),
          ].join("\n"),
        ),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "file_references",
    {
      title: "File references",
      description:
        "Return a bounded page of module references from the TypeScript project selected by file. Set raw to return every project-scoped reference.",
      inputSchema: input.FileReferences,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, offset = 0, limit = 20, raw = false, includeDiagnostics },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      const project = workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal);
      const result = await workspace.sendRequest(
        FindFileReferenceRequest.type,
        { textDocument },
        signal,
      );
      const output =
        result === null || result === undefined
          ? null
          : raw
            ? page(result, 0, result.length)
            : page(result, offset, limit);
      return appendDiagnosticContext(
        textResult(
          [
            formatProjectScope(await project, root),
            formatLocationPage("file references", output, root),
          ].join("\n"),
        ),
        await diagnosticContext,
      );
    },
  );

  registerTool(
    server,
    "document_highlights",
    {
      title: "Document highlights",
      description: "Return same-document semantic usages at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      const result = await workspace.sendRequest(
        DocumentHighlightRequest.type,
        { textDocument, position },
        signal,
      );
      return appendDiagnosticContext(
        textResult(formatDocumentHighlights(textDocument.uri, result, root)),
        await diagnosticContext,
      );
    },
  );
};
