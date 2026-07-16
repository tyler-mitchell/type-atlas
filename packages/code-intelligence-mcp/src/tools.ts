import {
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  CompletionRequest,
  CompletionResolveRequest,
  DefinitionRequest,
  DocumentDiagnosticRequest,
  DocumentHighlightRequest,
  type DocumentSymbol,
  DocumentSymbolRequest,
  FindFileReferenceRequest,
  GetMatchTsConfigRequest,
  HoverRequest,
  ImplementationRequest,
  InlayHintRequest,
  ReferencesRequest,
  SignatureHelpRequest,
  type SymbolInformation,
  TypeDefinitionRequest,
  type WorkspaceSymbol,
  WorkspaceSymbolRequest,
} from "@volar/language-server/protocol.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { type } from "arktype";
import { z } from "zod";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import type { VolarWorkspacePool } from "./volar-workspace.ts";
import {
  appendDiagnosticContext,
  formatCallHierarchy,
  formatCompletions,
  formatDiagnostics,
  formatDocumentHighlights,
  formatDocumentSymbols,
  formatHover,
  formatInlayHints,
  formatLocationPage,
  formatNavigation,
  formatPositionQuery,
  formatProjectConfig,
  formatProjectScope,
  formatSignatureHelp,
  formatWorkspaceSymbolScope,
  formatWorkspaceSymbols,
  type Page,
  textResult,
} from "./plain-text.ts";

const protocolPosition = type({
  line: "number.integer >= 0",
  character: "number.integer >= 0",
}).onUndeclaredKey("reject");

const protocolRange = type({
  start: protocolPosition,
  end: protocolPosition,
}).onUndeclaredKey("reject");

const fileInput = {
  workspace: "string >= 1",
  file: "string >= 1",
} as const;

const observedFileInput = {
  ...fileInput,
  includeDiagnostics: type("boolean")
    .describe("Include actionable diagnostics from the queried file when present.")
    .default(true),
} as const;

const input = type.module({
  File: type(fileInput).onUndeclaredKey("reject"),
  Position: type({
    ...observedFileInput,
    position: protocolPosition,
  }).onUndeclaredKey("reject"),
  DocumentSymbols: type({
    ...observedFileInput,
    "depth?": "0 <= number.integer <= 10",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  Completion: type({
    ...observedFileInput,
    position: protocolPosition,
    "offset?": "number.integer >= 0",
    "limit?": "1 <= number.integer <= 100",
    "resolve?": "boolean",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  Range: type({
    ...observedFileInput,
    range: protocolRange,
  }).onUndeclaredKey("reject"),
  References: type({
    ...observedFileInput,
    position: protocolPosition,
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
    query: "string",
    "offset?": "number.integer >= 0",
    "limit?": "1 <= number.integer <= 100",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  CallHierarchy: type({
    ...observedFileInput,
    position: protocolPosition,
    direction: "'incoming' | 'outgoing'",
  }).onUndeclaredKey("reject"),
});

const toMcpSchema = <Schema extends type.Any>(schema: Schema) =>
  z.fromJSONSchema(
    schema.toJsonSchema() as Parameters<typeof z.fromJSONSchema>[0],
  ) as z.ZodType<Schema["infer"]>;

const readOnly = { readOnlyHint: true } satisfies ToolAnnotations;

const page = <Item>(
  items: readonly Item[],
  offset: number,
  limit: number,
): Page<Item> => {
  const end = Math.min(offset + limit, items.length);
  return {
    total: items.length,
    offset,
    items: items.slice(offset, end),
    ...(end < items.length ? { nextOffset: end } : {}),
  };
};

const projectDocumentSymbol = (
  symbol: DocumentSymbol,
  depth: number,
): DocumentSymbol => {
  const { children, ...item } = symbol;
  return depth > 0 && children?.length
    ? {
      ...item,
      children: children.map((child) =>
        projectDocumentSymbol(child, depth - 1)
      ),
    }
    : item;
};

const projectDocumentSymbols = (
  symbols: (DocumentSymbol | SymbolInformation)[],
  depth: number,
) =>
  symbols.map((symbol) =>
    "range" in symbol ? projectDocumentSymbol(symbol, depth) : symbol
  );

export const registerObservabilityTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): void => {
  server.registerTool(
    "diagnostics",
    {
      description: "Return document diagnostics.",
      inputSchema: toMcpSchema(input.File),
      annotations: readOnly,
    },
    async ({ workspace: root, file }, { signal }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const result = await workspace.sendRequest(
        DocumentDiagnosticRequest.type,
        { textDocument },
        signal,
      );
      return textResult(
        formatDiagnostics(textDocument.uri, result, root),
      );
    },
  );

  server.registerTool(
    "document_symbols",
    {
      description:
        "Return the top-level document outline and source ranges. Set depth to include nested symbols or raw to return the complete hierarchy.",
      inputSchema: toMcpSchema(input.DocumentSymbols),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      depth = 0,
      raw = false,
      includeDiagnostics,
    }, { signal }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      const result = await workspace.sendRequest(
        DocumentSymbolRequest.type,
        { textDocument },
        signal,
      );
      const output = raw || result === null
        ? result
        : projectDocumentSymbols(result, depth);
      return appendDiagnosticContext(
        textResult(
          formatDocumentSymbols(textDocument.uri, output, root),
        ),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "workspace_symbols",
    {
      description:
        "Search a bounded page of symbols across TypeScript projects activated in this workspace session. The file activates its owning project. Set raw to return every result.",
      inputSchema: toMcpSchema(input.WorkspaceSymbols),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      query,
      offset = 0,
      limit = 10,
      raw = false,
    }, { signal }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const project = await workspace.sendRequest(
        GetMatchTsConfigRequest.type,
        textDocument,
        signal,
      );
      const result = await workspace.sendRequest(
        WorkspaceSymbolRequest.type,
        { query },
        signal,
      );
      const output = result === null
        ? null
        : raw
        ? page<SymbolInformation | WorkspaceSymbol>(result, 0, result.length)
        : page<SymbolInformation | WorkspaceSymbol>(result, offset, limit);
      return textResult(
        [
          formatWorkspaceSymbolScope(project, root),
          formatWorkspaceSymbols(output, root),
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "hover",
    {
      description: "Return type and documentation hover at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      includeDiagnostics,
    }, { signal }) => {
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
        HoverRequest.type,
        {
          textDocument,
          position,
        },
        signal,
      );
      return appendDiagnosticContext(
        textResult(formatHover(textDocument.uri, result, root)),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "signature_help",
    {
      description: "Return overload and parameter information at a call site.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      includeDiagnostics,
    }, { signal }) => {
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
        SignatureHelpRequest.type,
        {
          textDocument,
          position,
        },
        signal,
      );
      return appendDiagnosticContext(
        textResult(formatSignatureHelp(result)),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "completions",
    {
      description:
        "Return a bounded completion page at a source position. Set resolve to include upstream details for that page or raw to return every unresolved candidate.",
      inputSchema: toMcpSchema(input.Completion),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      offset = 0,
      limit = 10,
      resolve = false,
      raw = false,
      includeDiagnostics,
    }, { signal }) => {
      if (raw && resolve) {
        throw new Error("resolve cannot be combined with raw.");
      }
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
      const completion = await workspace.sendRequest(
        CompletionRequest.type,
        {
          textDocument,
          position,
        },
        signal,
      );
      const items = completion === null
        ? []
        : Array.isArray(completion)
        ? completion
        : completion.items;
      const end = Math.min(offset + limit, items.length);
      const selectedItems = raw ? items : resolve
        ? await Promise.all(
          items.slice(offset, end).map((item) =>
            workspace.sendRequest(
              CompletionResolveRequest.type,
              item,
              signal,
            )
          ),
        )
        : items.slice(offset, end);
      const result = completion === null ? null : {
        isIncomplete: Array.isArray(completion)
          ? false
          : completion.isIncomplete,
        total: items.length,
        offset: raw ? 0 : offset,
        items: selectedItems,
        ...(!Array.isArray(completion) && completion.itemDefaults
          ? { itemDefaults: completion.itemDefaults }
          : {}),
        ...(!raw && end < items.length ? { nextOffset: end } : {}),
      };
      return appendDiagnosticContext(
        textResult(formatCompletions(result)),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "definitions",
    {
      description: "Return definition locations at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      includeDiagnostics,
    }, { signal }) => {
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
        DefinitionRequest.type,
        {
          textDocument,
          position,
        },
        signal,
      );
      return appendDiagnosticContext(
        textResult(
          formatNavigation("definitions", result, root),
        ),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "type_definitions",
    {
      description: "Return type-definition locations at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      includeDiagnostics,
    }, { signal }) => {
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
        {
          textDocument,
          position,
        },
        signal,
      );
      return appendDiagnosticContext(
        textResult(
          formatNavigation("type definitions", result, root),
        ),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "implementations",
    {
      description: "Return implementation locations at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      includeDiagnostics,
    }, { signal }) => {
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
        {
          textDocument,
          position,
        },
        signal,
      );
      return appendDiagnosticContext(
        textResult(
          formatNavigation("implementations", result, root),
        ),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "references",
    {
      description:
        "Return a bounded page of reference locations from the TypeScript project selected by file. Set raw to return every project-scoped reference.",
      inputSchema: toMcpSchema(input.References),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      includeDeclaration = true,
      offset = 0,
      limit = 20,
      raw = false,
      includeDiagnostics,
    }, { signal }) => {
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
      const project = workspace.sendRequest(
        GetMatchTsConfigRequest.type,
        textDocument,
        signal,
      );
      const query = workspace.sendRequest(
        HoverRequest.type,
        { textDocument, position },
        signal,
      );
      const result = await workspace.sendRequest(
        ReferencesRequest.type,
        {
          textDocument,
          position,
          context: { includeDeclaration },
        },
        signal,
      );
      const output = result === null
        ? null
        : raw
        ? page(result, 0, result.length)
        : page(result, offset, limit);
      return appendDiagnosticContext(
        textResult(
          [
            formatProjectScope(await project, root),
            formatPositionQuery(
              textDocument.uri,
              position,
              await query,
              root,
            ),
            formatLocationPage("references", output, root),
          ].join("\n"),
        ),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "file_references",
    {
      description:
        "Return a bounded page of module references from the TypeScript project selected by file. Set raw to return every project-scoped reference.",
      inputSchema: toMcpSchema(input.FileReferences),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      offset = 0,
      limit = 20,
      raw = false,
      includeDiagnostics,
    }, { signal }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      const project = workspace.sendRequest(
        GetMatchTsConfigRequest.type,
        textDocument,
        signal,
      );
      const result = await workspace.sendRequest(
        FindFileReferenceRequest.type,
        { textDocument },
        signal,
      );
      const output = result === null || result === undefined
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

  server.registerTool(
    "document_highlights",
    {
      description: "Return same-document semantic usages at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      includeDiagnostics,
    }, { signal }) => {
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
        {
          textDocument,
          position,
        },
        signal,
      );
      return appendDiagnosticContext(
        textResult(
          formatDocumentHighlights(textDocument.uri, result, root),
        ),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "inlay_hints",
    {
      description: "Return inline type and parameter hints for a source range.",
      inputSchema: toMcpSchema(input.Range),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      range,
      includeDiagnostics,
    }, { signal }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        range,
      );
      const result = await workspace.sendRequest(
        InlayHintRequest.type,
        {
          textDocument,
          range,
        },
        signal,
      );
      return appendDiagnosticContext(
        textResult(
          formatInlayHints(textDocument.uri, result, root),
        ),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "call_hierarchy",
    {
      description: "Return one direction and one level of the call hierarchy.",
      inputSchema: toMcpSchema(input.CallHierarchy),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      direction,
      includeDiagnostics,
    }, { signal }) => {
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
      const items = await workspace.sendRequest(
        CallHierarchyPrepareRequest.type,
        {
          textDocument,
          position,
        },
        signal,
      );
      if (direction === "incoming") {
        const incomingCalls = items === null
          ? null
          : await Promise.all(items.map((item) =>
            workspace.sendRequest(
              CallHierarchyIncomingCallsRequest.type,
              { item },
              signal,
            )
          ));
        return appendDiagnosticContext(
          textResult(
            formatCallHierarchy(direction, {
              prepareCallHierarchy: items,
              incomingCalls,
            }, root),
          ),
          await diagnosticContext,
        );
      }
      const outgoingCalls = items === null
        ? null
        : await Promise.all(items.map((item) =>
          workspace.sendRequest(
            CallHierarchyOutgoingCallsRequest.type,
            { item },
            signal,
          )
        ));
      return appendDiagnosticContext(
        textResult(
          formatCallHierarchy(direction, {
            prepareCallHierarchy: items,
            outgoingCalls,
          }, root),
        ),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "project_config",
    {
      description:
        "Return the TypeScript configuration selected for a source file.",
      inputSchema: toMcpSchema(input.File),
      annotations: readOnly,
    },
    async ({ workspace: root, file }, { signal }) => {
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
