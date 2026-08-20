import { width } from "atlascii";
import { type Range, SymbolKind } from "vscode-languageserver-protocol";

/** Declarations that hold other code, rather than merely name a value. */
const holdingKinds = new Set<number>([
  SymbolKind.Function,
  SymbolKind.Method,
  SymbolKind.Constructor,
  SymbolKind.Class,
  SymbolKind.Interface,
  SymbolKind.Enum,
  SymbolKind.Module,
  SymbolKind.Namespace,
]);

/**
 * The declaration a located row sits in, as a reader would name it.
 *
 * Two entries in the chain are never the answer. The row's own declaration is
 * one — an object-literal property is a declaration in the outline, so
 * `down: "↓"` reported "inside down". A local binding is the other:
 * `const lines = references(...)` reported "inside lines", where what holds the
 * call is the function around it. So the innermost holder wins, and only when
 * the chain has none does the innermost remaining declaration answer — which is
 * what names a top-level `const figures` as the holder of the properties in it.
 */
export const enclosingDeclaration = (
  chain: readonly {
    readonly name?: string;
    readonly kind?: number;
    readonly selectionRange: Range;
  }[],
  range: Range,
) => {
  const others = [...chain]
    .reverse()
    .filter(
      (entry) =>
        entry.selectionRange.start.line !== range.start.line ||
        entry.selectionRange.start.character !== range.start.character,
    );
  return (
    others.find((entry) => entry.kind !== undefined && holdingKinds.has(entry.kind)) ?? others[0]
  );
};

export type ReferenceSite = {
  readonly file: string;
  readonly line: number;
  readonly character: number;
  /** The declaration holding this use. Absent at the top level of a module. */
  readonly within?: string;
};

/**
 * Uses under the file holding them — as a level, or on the line, whichever
 * says more.
 *
 * The path is a level when that saves repetition: thirteen uses in one module
 * printed the same forty characters thirteen times. It is not free, though. A
 * file holding one use costs two lines and a connector to say what fits on one,
 * and a list of single hits across many files is all header and no content.
 *
 * So the shape follows the data: grouped when some file holds more than one,
 * flat when none does. That is the same judgement `inspect_symbol` already
 * makes when it says "every call happens in X" rather than drawing one group,
 * and making it here means the document renders whichever arrives without
 * knowing which it was.
 *
 * Positions differ in width — `483:8` against `187:27` — so a group states the
 * widest of its own and the document holds every position to it. Only when
 * grouped: under a flat list each line begins with a different path, so there
 * is no column to hold to.
 *
 * `children` rather than a name of its own: what sits beneath a label is one
 * relation across every tool, and the guide that draws depth reads it by that
 * name. A group calling them `sites` could only ever be nested by a partial
 * written for that word, which is how three ways of drawing one shape got
 * built.
 */
export const referenceGroups = (sites: readonly ReferenceSite[]) => {
  const byFile = [...Map.groupBy(sites, (site) => site.file)];
  const worthGrouping = byFile.some(([, held]) => held.length > 1);
  if (!worthGrouping) {
    return sites.map((site) => ({
      file: site.file,
      at: `${site.line}:${site.character}`,
      within: site.within,
    }));
  }
  return byFile.map(([file, grouped]) => {
    const at = grouped.map((site) => `${site.line}:${site.character}`);
    const column = Math.max(...at.map((value) => width(value)));
    return {
      file,
      children: grouped.map((site, index) => ({
        at: at[index] ?? "",
        column,
        within: site.within,
      })),
    };
  });
};
