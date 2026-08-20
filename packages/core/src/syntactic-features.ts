import type { DocumentSymbol, FoldingRange } from "@volar/language-server/protocol.js";
import ts from "typescript";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getLanguageServiceByDocument } from "volar-service-typescript/lib/plugins/syntactic.js";
import {
  convertNavTree,
  convertOutliningSpan,
} from "volar-service-typescript/lib/utils/lspConverters.js";
import { foldingAffectsView, sourceLines, truncate } from "atlascii";

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

export type SourceWindow = {
  readonly startLine?: number;
  readonly endLine?: number;
};

export type SourceView = {
  readonly uri: string;
  readonly lines: readonly string[];
  readonly foldingRanges: readonly FoldingRange[];
};

export const readSourceView = async (input: {
  readonly workspace: {
    readonly getWorkspaceUri: (file: string) => string;
    readonly readTextDocumentUri: (
      uri: string,
      signal?: AbortSignal,
    ) => Promise<{ readonly source: string }>;
  };
  readonly file: string;
  readonly window?: SourceWindow;
  readonly fold?: boolean;
  readonly signal?: AbortSignal;
}): Promise<SourceView> => {
  const uri = input.workspace.getWorkspaceUri(input.file);
  const { source } = await input.workspace.readTextDocumentUri(uri, input.signal);
  // A NUL byte marks content no reader lines up — the same rule the literal
  // scanner applies. Without it, a zip archive answered as 152 lines of
  // mojibake presented as source.
  if (source.includes("\0")) {
    throw new Error(
      `${input.file} is a binary file (${source.length.toLocaleString("en-US")} bytes) — there is no text to read.`,
    );
  }
  const lines = sourceLines(source);
  const window = input.window ?? {};
  const viewLineCount = (window.endLine ?? lines.length) - (window.startLine ?? 1) + 1;
  return {
    uri,
    lines,
    foldingRanges:
      input.fold !== false && foldingAffectsView(viewLineCount)
        ? foldingRanges({ uri, source })
        : [],
  };
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
}): readonly DocumentSymbol[] | undefined => {
  const parse = parsed(input);
  if (!parse) return undefined;
  const roots = parse.languageService.getNavigationTree(parse.fileName).childItems ?? [];
  const typeAliases = new Set<string>();
  const collect = (items: readonly ts.NavigationTree[]) => {
    for (const item of items) {
      if (item.kind === "type") typeAliases.add(item.text);
      collect(item.childItems ?? []);
    }
  };
  collect(roots);
  // TypeScript's navigation tree names what it cannot name `<unknown>` — a
  // conditional spread has no identifier — and a parser token is not a name a
  // reader can act on. The member's own source is: collapsed to one line and
  // cut to a label's width, it says exactly what stands at that range.
  const named = (symbol: DocumentSymbol) =>
    symbol.name === "<unknown>"
      ? truncate({
          value: input.source
            .slice(
              parse.document.offsetAt(symbol.range.start),
              parse.document.offsetAt(symbol.range.end),
            )
            .replace(/\s+/gu, " ")
            .trim(),
          columns: 40,
        })
      : symbol.name;
  const corrected = (symbols: readonly DocumentSymbol[]): DocumentSymbol[] =>
    symbols.map((symbol) => ({
      ...symbol,
      name: named(symbol),
      kind: typeAliases.has(symbol.name) ? 11 : symbol.kind,
      ...(symbol.children ? { children: corrected(symbol.children) } : {}),
    }));
  return corrected(roots.flatMap((item) => convertNavTree(item, parse.document)));
};
