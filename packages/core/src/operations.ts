import { FileSizesRequest, ProjectDiagnosticsRequest } from "@type-atlas/language-server/protocol";
import {
  DefinitionRequest,
  DocumentDiagnosticRequest,
  DocumentLinkRequest,
  DocumentLinkResolveRequest,
  DocumentSymbolRequest,
  FoldingRangeRequest,
  GetMatchTsConfigRequest,
  HoverRequest,
  ReferencesRequest,
  SelectionRangeRequest,
  WorkspaceSymbolRequest,
} from "@volar/language-server/protocol.js";
import type { Position } from "vscode-languageserver-protocol";
import type { VolarWorkspace } from "./volar-workspace.ts";

const sourceCodeUri = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

/**
 * Matches generated declaration files.
 *
 * TypeScript's navigate-to API accepts `excludeDtsFiles`, but
 * `volar-service-typescript` calls `getNavigateToItems(query)` with no further
 * arguments and exposes no setting for them, so the choice cannot be made
 * upstream. Declarations are excluded here instead: a workspace package
 * consumed through its build output otherwise reports the generated
 * declaration next to the source it was generated from.
 */
const declarationUri = /\.d\.[cm]?ts$/i;

/**
 * Recovers the resource an editor command target encodes.
 *
 * `vscode-markdown-languageservice` resolves a link to a directory, or to a
 * file with a fragment, into a VS Code command URI rather than a plain target
 * (`out/languageFeatures/documentLinks.js:555` and `:562`). Those are
 * instructions to an editor host: they mean nothing outside a VS Code window,
 * and they carry the resource inside a percent-encoded JSON payload.
 *
 * The service takes no option to suppress them, and its plain-target API,
 * `resolveLinkTarget`, is not surfaced by `volar-service-markdown`, so the
 * encoding is reversed here. A target that cannot be recovered is dropped: an
 * agent cannot act on a command it has no host to run.
 */
const commandTargetResource = (target: string): string | undefined => {
  const separator = target.indexOf("?");
  if (!target.startsWith("command:") || separator < 0) return undefined;
  try {
    const payload: unknown = JSON.parse(decodeURIComponent(target.slice(separator + 1)));
    const resource = Array.isArray(payload) ? payload[0] : payload;
    const external = (resource as { readonly external?: unknown } | null)?.external;
    return typeof external === "string" ? external : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Creates project-aware language operations backed by an active workspace.
 *
 * File paths may be absolute or relative to the workspace root. Operations
 * observe filesystem changes through the workspace and honor cancellation
 * through the supplied signal. The caller retains ownership of the workspace.
 */
export const createTypeAtlas = (workspace: VolarWorkspace) => ({
  sourceSizes(files: readonly string[], signal: AbortSignal) {
    return workspace.sendRequest(
      FileSizesRequest.type,
      { uris: files.map((file) => workspace.getWorkspaceUri(file)) },
      signal,
    );
  },

  async readSource(file: string, fold: boolean, signal: AbortSignal) {
    const { textDocument, source } = await workspace.readTextDocument(file, signal);
    const foldingRanges = fold
      ? await workspace.sendRequest(FoldingRangeRequest.type, { textDocument }, signal)
      : [];
    return { textDocument, source, foldingRanges: foldingRanges ?? [] };
  },

  async diagnostics(file: string, signal: AbortSignal) {
    const textDocument = await workspace.getTextDocument(file);
    const report = await workspace.sendRequest(
      DocumentDiagnosticRequest.type,
      { textDocument },
      signal,
    );
    return { textDocument, report };
  },

  async projectDiagnostics(file: string, signal: AbortSignal) {
    const textDocument = await workspace.getTextDocument(file);
    const project = await workspace.sendRequest(
      ProjectDiagnosticsRequest.type,
      textDocument,
      signal,
    );
    return { textDocument, project };
  },

  async documentSymbols(file: string, signal: AbortSignal) {
    const textDocument = await workspace.getTextDocument(file);
    const symbols = await workspace.sendRequest(
      DocumentSymbolRequest.type,
      { textDocument },
      signal,
    );
    return { textDocument, symbols };
  },

  async documentLinks(file: string, signal: AbortSignal) {
    const textDocument = await workspace.getTextDocument(file);
    const links = await workspace.sendRequest(DocumentLinkRequest.type, { textDocument }, signal);
    const resolved = await Promise.all(
      (links ?? []).map((link) =>
        link.target ? link : workspace.sendRequest(DocumentLinkResolveRequest.type, link, signal),
      ),
    );
    return {
      textDocument,
      links: resolved.flatMap((link) => {
        if (!link?.target?.startsWith("command:")) return link ? [link] : [];
        const target = commandTargetResource(link.target);
        return target ? [{ ...link, target }] : [];
      }),
    };
  },

  async selectionRanges(file: string, positions: readonly Position[], signal: AbortSignal) {
    const textDocument = await workspace.getTextDocument(file);
    const ranges = await workspace.sendRequest(
      SelectionRangeRequest.type,
      { textDocument, positions: [...positions] },
      signal,
    );
    return { textDocument, ranges };
  },

  async hover(file: string, position: Position, signal: AbortSignal) {
    const textDocument = await workspace.getTextDocument(file);
    const hover = await workspace.sendRequest(
      HoverRequest.type,
      { textDocument, position },
      signal,
    );
    return { textDocument, hover };
  },

  async definitions(file: string, position: Position, signal: AbortSignal) {
    const textDocument = await workspace.getTextDocument(file);
    const definitions = await workspace.sendRequest(
      DefinitionRequest.type,
      { textDocument, position },
      signal,
    );
    return { textDocument, definitions };
  },

  async references(
    file: string,
    position: Position,
    includeDeclaration: boolean,
    signal: AbortSignal,
  ) {
    const textDocument = await workspace.getTextDocument(file);
    const references = await workspace.sendRequest(
      ReferencesRequest.type,
      {
        textDocument,
        position,
        context: { includeDeclaration },
      },
      signal,
    );
    return { textDocument, references };
  },

  async workspaceSymbols(file: string, query: string, signal: AbortSignal) {
    const textDocument = await workspace.getTextDocument(file);
    const project = await workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal);
    const symbols = await workspace.sendRequest(WorkspaceSymbolRequest.type, { query }, signal);
    return {
      textDocument,
      project,
      symbols:
        symbols?.filter(
          (symbol) =>
            sourceCodeUri.test(symbol.location.uri) && !declarationUri.test(symbol.location.uri),
        ) ?? symbols,
    };
  },
});

export type TypeAtlas = ReturnType<typeof createTypeAtlas>;
