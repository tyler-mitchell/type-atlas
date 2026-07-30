import {
  CompletionRequest,
  CompletionResolveRequest,
  InlayHintRequest,
  SignatureHelpRequest,
} from "@volar/language-server/protocol.js";
import { createTypeAtlas, listModuleExports } from "@typeatlas/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import {
  formatCompletions,
  formatHover,
  formatInlayHints,
  formatModuleExports,
  formatSignatureHelp,
} from "@typeatlas/core/text";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { observedFileInput, positionInput, rangeInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@typeatlas/core";

const input = type.module({
  Position: type({
    ...observedFileInput,
    position: positionInput,
  }).onUndeclaredKey("reject"),
  Completion: type({
    ...observedFileInput,
    position: positionInput,
    "offset?": "number.integer >= 0",
    "limit?": "1 <= number.integer <= 100",
    "resolve?": "boolean",
    "raw?": "boolean",
  }).onUndeclaredKey("reject"),
  Range: type({
    ...observedFileInput,
    range: rangeInput,
  }).onUndeclaredKey("reject"),
  ModuleExports: type({
    workspace: observedFileInput.workspace,
    module: type("string >= 1").describe(
      "Module specifier to inspect, such as react, @scope/package, or ./local-module.js.",
    ),
    fromFile: type("string >= 1").describe(
      "Workspace-relative or absolute importing file that determines the exact TypeScript project and package versions.",
    ),
    "path?": type("string[]").configure({
      description: 'Nested runtime export path to inspect, such as ["d"] or ["default"].',
    }),
    "surface?": type("'runtime' | 'all'").configure({
      default: "runtime",
      description:
        "Runtime exports by default; use all to include top-level type exports. Nested paths are runtime surfaces.",
    }),
    "query?": type("string").configure({
      default: "",
      description: "Optional case-insensitive text filter over Volar's completion labels.",
    }),
    "offset?": type("number.integer >= 0").configure({
      default: 0,
      description: "Zero-based offset into the completion results.",
    }),
    "limit?": type("1 <= number.integer <= 100").configure({
      default: 15,
      description: "Maximum exports returned.",
    }),
    "includeDetails?": type("boolean").configure({
      default: true,
      description: "Resolve the displayed exports to include signatures and declared shapes.",
    }),
    "includeDocs?": type("boolean").configure({
      default: false,
      description: "Include upstream documentation for the displayed exports.",
    }),
    "includeSubpaths?": type("boolean").configure({
      default: true,
      description: "Include declared importable subpaths when inspecting a package root.",
    }),
  }).onUndeclaredKey("reject"),
});

export const registerAssistanceTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): void => {
  server.registerTool(
    "hover",
    {
      title: "Hover",
      description: "Return type and documentation hover at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, hover } = await createTypeAtlas(workspace).hover(
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
        textResult(formatHover(textDocument.uri, hover, root)),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "signature_help",
    {
      title: "Signature help",
      description: "Return overload and parameter information at a call site.",
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
        SignatureHelpRequest.type,
        { textDocument, position },
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
      title: "Completions",
      description:
        "Return a bounded completion page at a source position. Set resolve to include upstream details for that page or raw to return every unresolved candidate.",
      inputSchema: input.Completion,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        file,
        position,
        offset = 0,
        limit = 10,
        resolve = false,
        raw = false,
        includeDiagnostics,
      },
      { mcpReq: { signal } },
    ) => {
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
      const result = await workspace.runResolverSequence(async () => {
        const completion = await workspace.sendRequest(
          CompletionRequest.type,
          { textDocument, position },
          signal,
        );
        const items =
          completion === null ? [] : Array.isArray(completion) ? completion : completion.items;
        const end = Math.min(offset + limit, items.length);
        const selectedItems = raw
          ? items
          : resolve
            ? await Promise.all(
                items
                  .slice(offset, end)
                  .map((item) =>
                    workspace.sendRequest(CompletionResolveRequest.type, item, signal),
                  ),
              )
            : items.slice(offset, end);
        return completion === null
          ? null
          : {
              isIncomplete: Array.isArray(completion) ? false : completion.isIncomplete,
              total: items.length,
              offset: raw ? 0 : offset,
              items: selectedItems,
              ...(!Array.isArray(completion) && completion.itemDefaults
                ? { itemDefaults: completion.itemDefaults }
                : {}),
              ...(!raw && end < items.length ? { nextOffset: end } : {}),
            };
      }, signal);
      return appendDiagnosticContext(
        textResult(formatCompletions(result)),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "inlay_hints",
    {
      title: "Inlay hints",
      description: "Return inline type and parameter hints for a source range.",
      inputSchema: input.Range,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, range, includeDiagnostics }, { mcpReq: { signal } }) => {
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
        { textDocument, range },
        signal,
      );
      return appendDiagnosticContext(
        textResult(formatInlayHints(textDocument.uri, result, root)),
        await diagnosticContext,
      );
    },
  );

  server.registerTool(
    "list_module_exports",
    {
      title: "Inspect module",
      description:
        "Inspect the module surface visible from an importing TypeScript file. Returns signatures by default, declared package subpaths at package roots, nested runtime paths on request, and type-only exports as an opt-in.",
      inputSchema: input.ModuleExports,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        module,
        fromFile,
        path = [],
        surface = "runtime",
        query = "",
        offset = 0,
        limit = 15,
        includeDetails = true,
        includeDocs = false,
        includeSubpaths = true,
      },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      return textResult(
        formatModuleExports(
          await listModuleExports({
            workspace,
            module,
            fromFile,
            path,
            surface,
            query,
            offset,
            limit,
            includeDetails,
            includeDocs,
            includeSubpaths,
            signal,
          }),
        ),
      );
    },
  );
};
