import { FileSizesRequest } from "@typeatlas/language-server/protocol";
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
    return {
      textDocument,
      links: await workspace.runResolverSequence(async () => {
        const links = await workspace.sendRequest(
          DocumentLinkRequest.type,
          { textDocument },
          signal,
        );
        return await Promise.all(
          (links ?? []).map((link) =>
            link.target
              ? link
              : workspace.sendRequest(DocumentLinkResolveRequest.type, link, signal),
          ),
        );
      }, signal),
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
    return { textDocument, project, symbols };
  },
});

export type TypeAtlas = ReturnType<typeof createTypeAtlas>;
