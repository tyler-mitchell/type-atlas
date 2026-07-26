import {
  CompletionRequest,
  CompletionResolveRequest,
  InlayHintRequest,
  SignatureHelpRequest,
} from "@volar/language-server/protocol.js";
import { createCodeIntelligence } from "@featuretype/code-intelligence";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import {
  formatCompletions,
  formatHover,
  formatInlayHints,
  formatSignatureHelp,
} from "@featuretype/code-intelligence/text";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import {
  observedFileInput,
  positionInput,
  rangeInput,
} from "./tool-input.ts";
import type { VolarWorkspacePool } from "@featuretype/code-intelligence";

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
    async ({
      workspace: root,
      file,
      position,
      includeDiagnostics,
    }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, hover } = await createCodeIntelligence(workspace)
        .hover(file, position, signal);
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
    async ({
      workspace: root,
      file,
      position,
      includeDiagnostics,
    }, { mcpReq: { signal } }) => {
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
    async ({
      workspace: root,
      file,
      position,
      offset = 0,
      limit = 10,
      resolve = false,
      raw = false,
      includeDiagnostics,
    }, { mcpReq: { signal } }) => {
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
        return completion === null ? null : {
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
    async ({
      workspace: root,
      file,
      range,
      includeDiagnostics,
    }, { mcpReq: { signal } }) => {
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
};
