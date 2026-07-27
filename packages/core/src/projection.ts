import type { DocumentSymbol, SymbolInformation } from "@volar/language-server/protocol.js";
import type { Page } from "./plain-text.ts";

const projectDocumentSymbol = (symbol: DocumentSymbol, depth: number): DocumentSymbol => {
  const { children, ...item } = symbol;
  return depth > 0 && children?.length
    ? {
        ...item,
        children: children.map((child) => projectDocumentSymbol(child, depth - 1)),
      }
    : item;
};

/** Limits nested document symbols while preserving the server's top-level results and ranges. */
export const projectDocumentSymbols = (
  symbols: (DocumentSymbol | SymbolInformation)[],
  depth: number,
) => symbols.map((symbol) => ("range" in symbol ? projectDocumentSymbol(symbol, depth) : symbol));

/** Returns one bounded page without changing the order of the source collection. */
export const page = <Item>(items: readonly Item[], offset: number, limit: number): Page<Item> => {
  const end = Math.min(offset + limit, items.length);
  return {
    total: items.length,
    offset,
    items: items.slice(offset, end),
    ...(end < items.length ? { nextOffset: end } : {}),
  };
};
