import type { FeatureCodeBlock, FeatureParseError } from "@featuretype/core";
import type { LanguageServicePlugin } from "@volar/language-service";
import {
  DiagnosticSeverity,
  SymbolKind,
  type DocumentSymbol,
} from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import { FeatureTypeVirtualCode } from "./languagePlugin";

export function createFeatureTypeServicePlugin(): LanguageServicePlugin {
  return {
    name: "featuretype",
    capabilities: {
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
      documentSymbolProvider: true,
    },
    create(context) {
      return {
        provideDiagnostics(document) {
          const root = getFeatureTypeRoot(context, document.uri);
          if (!root) {
            return;
          }

          return root.document.errors.map((error) => toDiagnostic(document, error));
        },

        provideDocumentSymbols(document) {
          const root = getFeatureTypeRoot(context, document.uri);
          if (!root) {
            return;
          }

          return root.document.codeBlocks.map((codeBlock) =>
            toDocumentSymbol(document, codeBlock)
          );
        },
      };
    },
  };
}

function getFeatureTypeRoot(
  context: Parameters<LanguageServicePlugin["create"]>[0],
  uri: string,
): FeatureTypeVirtualCode | undefined {
  const parsedUri = URI.parse(uri);
  const decoded = context.decodeEmbeddedDocumentUri(parsedUri);

  if (decoded) {
    if (decoded[1] !== "root") {
      return undefined;
    }

    const sourceScript = context.language.scripts.get(decoded[0]);
    const root = sourceScript?.generated?.root;
    if (root instanceof FeatureTypeVirtualCode) {
      return root;
    }
  }

  const sourceScript = context.language.scripts.get(parsedUri);
  const root = sourceScript?.generated?.root;
  if (root instanceof FeatureTypeVirtualCode) {
    return root;
  }
}

function toDocumentSymbol(
  document: {
    positionAt(offset: number): { line: number; character: number };
  },
  codeBlock: FeatureCodeBlock,
): DocumentSymbol {
  const selectionStart = codeBlock.fileRange?.start ??
    codeBlock.range.infoStart;
  const selectionEnd = codeBlock.fileRange?.end ??
    codeBlock.range.infoEnd;

  return {
    name: codeBlock.file ?? codeBlock.id,
    detail: codeBlock.importable
      ? codeBlock.language
      : `${codeBlock.language} anonymous`,
    kind: SymbolKind.Module,
    range: toRange(document, {
      start: codeBlock.range.fenceStart,
      end: codeBlock.range.fenceEnd,
    }),
    selectionRange: toRange(document, {
      start: selectionStart,
      end: selectionEnd,
    }),
    children: [],
  };
}

function toDiagnostic(
  document: {
    positionAt(offset: number): { line: number; character: number };
  },
  error: FeatureParseError,
) {
  const range = error.range ?? { start: 0, end: 0 };
  return {
    code: error.code,
    message: error.message,
    range: toRange(document, range),
    severity:
      error.severity === "warning"
        ? DiagnosticSeverity.Warning
        : DiagnosticSeverity.Error,
    source: "featuretype",
  };
}

function toRange(
  document: { positionAt(offset: number): { line: number; character: number } },
  range: { start: number; end: number },
) {
  return {
    start: document.positionAt(range.start),
    end: document.positionAt(range.end),
  };
}
