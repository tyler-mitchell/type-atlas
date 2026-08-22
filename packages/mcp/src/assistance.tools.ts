import {
  CompletionRequest,
  CompletionResolveRequest,
  InlayHintRequest,
  SignatureHelpRequest,
} from "@volar/language-server/protocol.js";
import { createTypeAtlas, listModuleExports, renderDocument } from "@type-atlas/core";
import {
  containsPosition,
  defaultDimensions,
  displayPath,
  markupText,
  positionText,
  rangeText,
  truncate,
} from "@type-atlas/atlascii";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { requestDiagnosticContext } from "./ambient-diagnostics.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { registerTool } from "./tool.ts";
import { observedFileInput, paginationInput, positionInput, rangeInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@type-atlas/core";

const input = type.module({
  Position: type({
    ...observedFileInput,
    position: positionInput,
  }),
  Completion: type({
    ...observedFileInput,
    position: positionInput,
    ...paginationInput,
    "resolve?": type("boolean").configure({
      description:
        "Resolve documentation and insert details for the returned page. Costs an extra request per candidate.",
    }),
  }),
  Range: type({
    ...observedFileInput,
    range: rangeInput,
  }),
  ModuleExports: type({
    workspace: observedFileInput.workspace,
    module: type("string >= 1").describe(
      "Module specifier to inspect, such as react, @scope/package, or ./local-module.js.",
    ),
    fromFile: type("string >= 1").describe(
      "Workspace-relative or absolute importing file that determines the exact TypeScript project and package versions.",
    ),
    "type?": type("string >= 1").configure({
      description:
        "Module-scoped exported type expression whose instance members to inspect, such as TgpuRoot or TgpuBuffer<any>. Type-only surfaces are opt-in.",
    }),
    "path?": type("string[]").configure({
      description:
        'Nested member path to inspect, such as ["d"], ["default"], or ["device"] with an exported type.',
    }),
    "surface?": type("'runtime' | 'all'").configure(
      {
        default: "runtime",
        description:
          "Runtime exports by default; use all to include top-level type exports. Nested paths are runtime surfaces.",
      },
      "self",
    ),
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
  }),
});

export const registerAssistanceTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): void => {
  registerTool(
    server,
    "hover",
    {
      title: "Hover",
      description: "Return type and documentation hover at a position.",
      inputSchema: input.Position,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const { textDocument, result: hover } = await createTypeAtlas(workspace).hover({
        file,
        signal,
        params: { position },
      });
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
        position,
      );
      const rendered = await renderDocument({
        document: "hover.tool.mdoc",
        variables: {
          file: displayPath(textDocument.uri, root),
          root,
          at: positionText(position),
          text: markupText(hover?.contents),
        },
      });
      return appendDiagnosticContext(rendered.text, diagnosticContext);
    },
  );

  registerTool(
    server,
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
      const overloads = result?.signatures ?? [];
      const active = overloads[result?.activeSignature ?? 0];
      const rendered = await renderDocument({
        document: "signature-help.tool.mdoc",
        variables: {
          total: overloads.length,
          file: displayPath(textDocument.uri, root),
          root,
          at: positionText(position),
          // Which overload is in use only tells a reader something when there
          // is more than one; naming it beside a single signature repeated the
          // signature they were about to read.
          activeIndex:
            overloads.length > 1 && active ? String((result?.activeSignature ?? 0) + 1) : undefined,
          // Parameters name themselves and nothing else. Their documentation is
          // the same sentence under every overload — `Array.filter` printed one
          // description four times across two signatures — and it abutted the
          // type with no separator, so `=> value is S A function that accepts…`
          // read as one expression. The signature above already carries the
          // types; hover is where prose about a symbol lives. The one fact the
          // rows add is which parameter the position sits in — the question an
          // agent mid-call is actually asking. A signature-level
          // activeParameter overrides the help-level one; null means none.
          signatures: overloads.map((entry, index) => {
            const activeParameter =
              index === (result?.activeSignature ?? 0)
                ? entry.activeParameter !== undefined
                  ? entry.activeParameter
                  : result?.activeParameter
                : undefined;
            return {
              name: entry.label,
              children: (entry.parameters ?? []).map((parameter, parameterIndex) => {
                const label =
                  typeof parameter.label === "string"
                    ? parameter.label
                    : entry.label.slice(parameter.label[0], parameter.label[1]);
                return {
                  name: parameterIndex === activeParameter ? `${label} · active` : label,
                };
              }),
            };
          }),
        },
      });
      return appendDiagnosticContext(rendered.text, diagnosticContext);
    },
  );

  registerTool(
    server,
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
                .map((item) => workspace.sendRequest(CompletionResolveRequest.type, item, signal)),
            )
          : items.slice(offset, end);
      const result =
        completion === null
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
      const rendered = await renderDocument({
        document: "completions.tool.mdoc",
        variables: {
          total: result?.total ?? 0,
          file: displayPath(textDocument.uri, root),
          root,
          at: positionText(position),
          incomplete: result?.isIncomplete ?? false,
          page:
            (result?.offset ?? 0) + (result?.items.length ?? 0) < (result?.total ?? 0)
              ? {
                  from: (result?.offset ?? 0) + 1,
                  to: (result?.offset ?? 0) + (result?.items.length ?? 0),
                  total: result?.total ?? 0,
                  next: result?.nextOffset,
                  unit: "completions",
                }
              : undefined,
          items: (result?.items ?? []).map((item) => ({
            name: item.label,
            notes: [item.detail, markupText(item.documentation)].filter(Boolean),
          })),
        },
      });
      return appendDiagnosticContext(rendered.text, diagnosticContext);
    },
  );

  registerTool(
    server,
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
      const hints = result ?? [];
      const rendered = await renderDocument({
        document: "inlay-hints.tool.mdoc",
        variables: {
          file: displayPath(textDocument.uri, root),
          root,
          // The range asked about. A count with no extent could describe any
          // part of the file, and this tool is always asked about a part.
          at: rangeText(range),
          // Only the asked range, counted after the cut: the provider answers
          // past it — a hint at 32:2 arrived for a range ending at 30:1 — and
          // a header counting rows the filter then dropped said "2 hints"
          // over one row.
          total: hints.filter((hint) => containsPosition(range, hint.position)).length,
          // One line per hint, whatever the provider printed: a label carrying
          // newlines — a multi-line object type — wrapped under the tree's
          // guides and interleaved guide marks into its own words, shredding
          // "workspace-edit.ts" into "./wo | space-edi | ts". A hint is an
          // annotation, not a listing; the full type is one hover away.
          hints: hints
            .filter((hint) => containsPosition(range, hint.position))
            // Reading order, not provider order: the engine answers grouped
            // by hint kind, which interleaves positions.
            .sort(
              (left, right) =>
                left.position.line - right.position.line ||
                left.position.character - right.position.character,
            )
            .map((hint) => ({
              name: positionText(hint.position),
              notes: [
                truncate({
                  value: (typeof hint.label === "string"
                    ? hint.label
                    : hint.label.map((part) => part.value).join("")
                  ).replace(/\s+/gu, " "),
                  columns: defaultDimensions.summaryColumns,
                }),
              ],
            })),
        },
      });
      return appendDiagnosticContext(rendered.text, diagnosticContext);
    },
  );

  registerTool(
    server,
    "list_module_exports",
    {
      title: "Inspect module",
      description:
        "Inspect the usable module surface visible from an importing TypeScript file. Returns runtime signatures by default, declared package subpaths at package roots, nested runtime paths on request, and exported types or their members as opt-ins.",
      inputSchema: input.ModuleExports,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        module,
        fromFile,
        type,
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
      const surfaced = await listModuleExports({
        workspace,
        module,
        fromFile,
        type,
        path,
        surface,
        query,
        offset,
        limit,
        includeDetails,
        includeDocs,
        includeSubpaths,
        signal,
      });
      const rendered = await renderDocument({
        document: "module-exports.tool.mdoc",
        variables: {
          module: surfaced.module,
          surface: surfaced.surface,
          // An empty query is absent, not empty: `matching ` with nothing after
          // it read as a truncated sentence.
          query: surfaced.query || undefined,
          from: displayPath(workspace.getWorkspaceUri(fromFile), root),
          root,
          broadened: surfaced.broadened,
          total: surfaced.total,
          page:
            surfaced.offset + surfaced.items.length < surfaced.total
              ? {
                  from: surfaced.offset + 1,
                  to: surfaced.offset + surfaced.items.length,
                  total: surfaced.total,
                  next: surfaced.nextOffset,
                  unit: "exports",
                }
              : undefined,
          items: surfaced.items.map((item) => ({
            name: item.label,
            signature: item.detail,
            deprecated: item.tags?.includes(1),
          })),
        },
      });
      return textResult(rendered.text);
    },
  );
};
