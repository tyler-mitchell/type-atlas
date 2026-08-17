import type { DocumentSymbol, FoldingRange } from "@volar/language-server/protocol.js";
import ts from "typescript";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getLanguageServiceByDocument } from "volar-service-typescript/lib/plugins/syntactic.js";
import { convertNavTree, convertOutliningSpan } from "volar-service-typescript/lib/utils/lspConverters.js";

/**
 * What a source file says about itself, read from its text alone.
 *
 * Folding ranges and a document outline are syntactic: TypeScript answers both
 * from one parsed file, with no program, no `tsconfig.json`, and no knowledge of
 * anything the file imports. `volar-service-typescript` says so too — its
 * syntactic plugin provides exactly these, over a shared syntax-only service —
 * but a request reaching that plugin through the language server is first
 * resolved to the project owning the document, which builds that project's whole
 * program. Measured on a 3,545-file project: 4.8 seconds to fold one file
 * against 8 milliseconds here, and one semantic search enriching results from
 * four packages built four programs to label them.
 *
 * These call the same service and the same converters that plugin does, so the
 * answers are identical; only the project is absent.
 */
const scriptLanguageId: Readonly<Record<string, string>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
};

/**
 * Parses one document, or reports that TypeScript has nothing to say about it.
 *
 * A document carries its language rather than its path, and the script kind the
 * parser is given follows from it — a `.tsx` parsed as `.ts` reports its JSX as
 * syntax errors and finds no structure inside it.
 */
const parsed = (input: { readonly uri: string; readonly source: string }) => {
  const languageId = scriptLanguageId[input.uri.slice(input.uri.lastIndexOf(".") + 1)];
  if (!languageId) return undefined;
  const document = TextDocument.create(input.uri, languageId, 0, input.source);
  return { document, ...getLanguageServiceByDocument(ts, document) };
};

/** Folding ranges for one source document. */
export const foldingRanges = (input: {
  readonly uri: string;
  readonly source: string;
}): readonly FoldingRange[] => {
  const parse = parsed(input);
  if (!parse) return [];
  return parse.languageService
    .getOutliningSpans(parse.fileName)
    .map((span) => convertOutliningSpan(span, parse.document));
};

/**
 * The declaration outline of one source document.
 *
 * The navigation tree's root stands for the file itself, which is not a
 * declaration in it, so its children are the outline.
 */
export const documentSymbols = (input: {
  readonly uri: string;
  readonly source: string;
}): readonly DocumentSymbol[] => {
  const parse = parsed(input);
  if (!parse) return [];
  return (
    parse.languageService
      .getNavigationTree(parse.fileName)
      .childItems?.flatMap((item) => convertNavTree(item, parse.document)) ?? []
  );
};
