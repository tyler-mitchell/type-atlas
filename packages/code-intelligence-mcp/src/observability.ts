import {
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  type CompletionItem,
  CompletionResolveRequest,
  CompletionRequest,
  DefinitionRequest,
  DocumentDiagnosticRequest,
  DocumentHighlightRequest,
  type DocumentSymbol,
  DocumentSymbolRequest,
  GetMatchTsConfigRequest,
  HoverRequest,
  ImplementationRequest,
  InlayHintRequest,
  ReferencesRequest,
  SignatureHelpRequest,
  type SymbolInformation,
  TypeDefinitionRequest,
  WorkspaceSymbolRequest,
} from "@volar/language-server/protocol.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { type } from "arktype";
import { z } from "zod";
import { createVolarWorkspace } from "./volar-workspace.ts";

const protocolPosition = type({
  line: "number.integer >= 0",
  character: "number.integer >= 0",
}).onUndeclaredKey("reject");

const protocolRange = type({
  start: protocolPosition,
  end: protocolPosition,
}).onUndeclaredKey("reject");

const input = type.module({
  File: type({
    workspace: "string >= 1",
    file: "string >= 1",
  }).onUndeclaredKey("reject"),
  Position: type({
    workspace: "string >= 1",
    file: "string >= 1",
    position: protocolPosition,
  }).onUndeclaredKey("reject"),
  DocumentSymbols: type({
    workspace: "string >= 1",
    file: "string >= 1",
    "depth?": "0 <= number.integer <= 10",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  Completion: type({
    workspace: "string >= 1",
    file: "string >= 1",
    position: protocolPosition,
    "offset?": "number.integer >= 0",
    "limit?": "1 <= number.integer <= 100",
    "resolve?": "boolean",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  Range: type({
    workspace: "string >= 1",
    file: "string >= 1",
    range: protocolRange,
  }).onUndeclaredKey("reject"),
  References: type({
    workspace: "string >= 1",
    file: "string >= 1",
    position: protocolPosition,
    "includeDeclaration?": "boolean",
    "offset?": "number.integer >= 0",
    "limit?": "1 <= number.integer <= 100",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  WorkspaceSymbols: type({
    workspace: "string >= 1",
    file: "string >= 1",
    query: "string",
    "offset?": "number.integer >= 0",
    "limit?": "1 <= number.integer <= 100",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  CallHierarchy: type({
    workspace: "string >= 1",
    file: "string >= 1",
    position: protocolPosition,
    direction: "'incoming' | 'outgoing'",
  }).onUndeclaredKey("reject"),
});

const toMcpSchema = <Schema extends type.Any>(schema: Schema) =>
  z.fromJSONSchema(
    schema.toJsonSchema() as Parameters<typeof z.fromJSONSchema>[0],
  ) as z.ZodType<Schema["infer"]>;

const readOnly = { readOnlyHint: true } satisfies ToolAnnotations;

const page = <Items extends readonly unknown[]>(
  items: Items,
  offset: number,
  limit: number,
) => {
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
) => symbols.map((symbol) =>
  "range" in symbol ? projectDocumentSymbol(symbol, depth) : symbol
);

export const registerObservabilityTools = (server: McpServer): void => {
  server.registerTool(
    "diagnostics",
    {
      description: "Return document diagnostics.",
      inputSchema: toMcpSchema(input.File),
      annotations: readOnly,
    },
    async ({ workspace: root, file }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          DocumentDiagnosticRequest.type,
          { textDocument },
          signal,
        );
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "document_symbols",
    {
      description:
        "Return the top-level document outline and source ranges. Set depth to include nested symbols or raw to return the complete LSP hierarchy.",
      inputSchema: toMcpSchema(input.DocumentSymbols),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      depth = 0,
      raw = false,
    }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          DocumentSymbolRequest.type,
          { textDocument },
          signal,
        );
        const output = raw || result === null
          ? result
          : projectDocumentSymbols(result, depth);
        return {
          content: [],
          structuredContent: output === undefined
            ? {}
            : { result: output },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "workspace_symbols",
    {
      description:
        "Search a bounded page of symbols in the TypeScript project selected by file. Set raw to return the complete LSP payload.",
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
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        await workspace.sendRequest(
          GetMatchTsConfigRequest.type,
          textDocument,
          signal,
        );
        const result = await workspace.sendRequest(
          WorkspaceSymbolRequest.type,
          { query },
          signal,
        );
        const output = raw || result === null
          ? result
          : page(result, offset, limit);
        return {
          content: [],
          structuredContent: { result: output },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "hover",
    {
      description: "Return type and documentation hover at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({ workspace: root, file, position }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          HoverRequest.type,
          {
            textDocument,
            position,
          },
          signal,
        );
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "signature_help",
    {
      description: "Return overload and parameter information at a call site.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({ workspace: root, file, position }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          SignatureHelpRequest.type,
          {
            textDocument,
            position,
          },
          signal,
        );
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "completions",
    {
      description:
        "Return a bounded completion page at a source position. Set resolve to include upstream details for that page or raw to return the complete unresolved LSP payload.",
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
    }, { signal }) => {
      if (raw && resolve) {
        throw new Error("resolve cannot be combined with raw.");
      }
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const completion = await workspace.sendRequest(
          CompletionRequest.type,
          {
            textDocument,
            position,
          },
          signal,
        );
        const compact = (item: CompletionItem) => {
          const {
            commitCharacters: _commitCharacters,
            data: _data,
            filterText: _filterText,
            insertText: _insertText,
            sortText: _sortText,
            ...candidate
          } = item;
          return candidate;
        };
        const items = completion === null
          ? []
          : Array.isArray(completion)
          ? completion
          : completion.items;
        const end = Math.min(offset + limit, items.length);
        const selectedItems = resolve
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
        const result = raw || completion === null
          ? completion
          : {
            isIncomplete: Array.isArray(completion)
              ? false
              : completion.isIncomplete,
            total: items.length,
            offset,
            items: selectedItems.map(compact),
            ...(end < items.length ? { nextOffset: end } : {}),
          };
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "definitions",
    {
      description: "Return definition locations at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({ workspace: root, file, position }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          DefinitionRequest.type,
          {
            textDocument,
            position,
          },
          signal,
        );
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "type_definitions",
    {
      description: "Return type-definition locations at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({ workspace: root, file, position }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          TypeDefinitionRequest.type,
          {
            textDocument,
            position,
          },
          signal,
        );
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "implementations",
    {
      description: "Return implementation locations at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({ workspace: root, file, position }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          ImplementationRequest.type,
          {
            textDocument,
            position,
          },
          signal,
        );
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "references",
    {
      description:
        "Return a bounded page of reference locations at a position. Set raw to return the complete LSP payload.",
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
    }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          ReferencesRequest.type,
          {
            textDocument,
            position,
            context: { includeDeclaration },
          },
          signal,
        );
        const output = raw || result === null
          ? result
          : page(result, offset, limit);
        return {
          content: [],
          structuredContent: output === undefined
            ? {}
            : { result: output },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "document_highlights",
    {
      description: "Return same-document semantic usages at a position.",
      inputSchema: toMcpSchema(input.Position),
      annotations: readOnly,
    },
    async ({ workspace: root, file, position }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          DocumentHighlightRequest.type,
          {
            textDocument,
            position,
          },
          signal,
        );
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
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
    }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          InlayHintRequest.type,
          {
            textDocument,
            range,
          },
          signal,
        );
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "call_hierarchy",
    {
      description:
        "Return one direction and one level of the call hierarchy.",
      inputSchema: toMcpSchema(input.CallHierarchy),
      annotations: readOnly,
    },
    async ({
      workspace: root,
      file,
      position,
      direction,
    }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const items = await workspace.sendRequest(
          CallHierarchyPrepareRequest.type,
          {
            textDocument,
            position,
          },
          signal,
        );
        const calls = items === null
          ? null
          : direction === "incoming"
          ? await Promise.all(items.map((item) =>
            workspace.sendRequest(
              CallHierarchyIncomingCallsRequest.type,
              { item },
              signal,
            )
          ))
          : await Promise.all(items.map((item) =>
            workspace.sendRequest(
              CallHierarchyOutgoingCallsRequest.type,
              { item },
              signal,
            )
          ));
        const result = direction === "incoming"
          ? { prepareCallHierarchy: items, incomingCalls: calls }
          : { prepareCallHierarchy: items, outgoingCalls: calls };
        return {
          content: [],
          structuredContent: { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

  server.registerTool(
    "project_config",
    {
      description: "Return the TypeScript configuration selected for a source file.",
      inputSchema: toMcpSchema(input.File),
      annotations: readOnly,
    },
    async ({ workspace: root, file }, { signal }) => {
      const workspace = await createVolarWorkspace(root, signal);
      try {
        const textDocument = await workspace.getTextDocument(file);
        const result = await workspace.sendRequest(
          GetMatchTsConfigRequest.type,
          textDocument,
          signal,
        );
        return {
          content: [],
          structuredContent: result === undefined
            ? {}
            : { result },
        };
      } finally {
        await workspace.dispose();
      }
    },
  );

};
