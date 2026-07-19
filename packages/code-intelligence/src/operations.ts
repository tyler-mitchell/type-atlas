import { readFile } from "node:fs/promises";
import {
  DefinitionRequest,
  DocumentDiagnosticRequest,
  DocumentSymbolRequest,
  FoldingRangeRequest,
  GetMatchTsConfigRequest,
  HoverRequest,
  ReferencesRequest,
  WorkspaceSymbolRequest,
} from "@volar/language-server/protocol.js";
import type { Position } from "vscode-languageserver-protocol";
import type { VolarWorkspace } from "./volar-workspace.ts";

export const createCodeIntelligence = (workspace: VolarWorkspace) => ({
  async readSource(file: string, fold: boolean, signal: AbortSignal) {
    const textDocument = await workspace.getTextDocument(file);
    const [source, foldingRanges] = await Promise.all([
      readFile(new URL(textDocument.uri), "utf8"),
      fold
        ? workspace.sendRequest(
          FoldingRangeRequest.type,
          { textDocument },
          signal,
        )
        : Promise.resolve([]),
    ]);
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

  async workspaceSymbols(
    file: string,
    query: string,
    signal: AbortSignal,
  ) {
    const textDocument = await workspace.getTextDocument(file);
    const project = await workspace.sendRequest(
      GetMatchTsConfigRequest.type,
      textDocument,
      signal,
    );
    const symbols = await workspace.sendRequest(
      WorkspaceSymbolRequest.type,
      { query },
      signal,
    );
    return { textDocument, project, symbols };
  },
});

export type CodeIntelligence = ReturnType<typeof createCodeIntelligence>;
