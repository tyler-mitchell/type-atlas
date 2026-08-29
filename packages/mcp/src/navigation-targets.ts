import { declarationAtPosition, type VolarWorkspace } from "@type-atlas/core";
import { containsPosition, displayPath, sameRange } from "@type-atlas/atlascii";

/**
 * Shapes navigation results into the records a document renders.
 *
 * `origin` carries one rule rather than any layout: the implementation request
 * answers with the declaration itself for anything not overridden, and a lone
 * target spanning the asked-about position means there are none.
 *
 * It lives on its own rather than beside the tools that register those
 * documents because a composition asks the same three questions — definitions,
 * type definitions, implementations — and shaping them a second way would let
 * the two answers drift, starting with that rule.
 */
export const navigationTargets = async (input: {
  readonly result: unknown;
  readonly root: string;
  readonly workspace: VolarWorkspace;
  readonly signal: AbortSignal;
  readonly limit?: number;
  readonly origin?: {
    readonly uri: string;
    readonly position: { line: number; character: number };
  };
}) => {
  const { result, root, origin } = input;
  // A jump target answered as coordinates alone makes a reader open the file
  // to learn the one thing they asked. A LocationLink's selection spans the
  // identifier itself, so the text under it IS the name — the same fact the
  // references subject reads. Only a plain `Location` falls back to the
  // outline, because its range spans the whole declaration and slicing one
  // line of a 40-line type yields an empty string.
  const all = !result ? [] : Array.isArray(result) ? result : [result];
  const declaresOrigin =
    origin !== undefined &&
    all.length === 1 &&
    all.every((item) => {
      const uri = "targetUri" in item ? item.targetUri : item.uri;
      const range = "targetUri" in item ? item.targetRange : item.range;
      return uri === origin.uri && containsPosition(range, origin.position);
    });
  const found = declaresOrigin ? [] : all;
  return {
    declaresOrigin,
    total: found.length,
    items: await Promise.all(
      found.slice(0, input.limit).map(async (item) => {
        const linked = "targetUri" in item;
        const uri = linked ? item.targetUri : item.uri;
        const selection = linked ? item.targetSelectionRange : item.range;
        const extent = linked ? item.targetRange : item.range;
        const sliced = linked
          ? await input.workspace
              .readTextDocumentUri(uri, input.signal)
              .then(({ source }) =>
                (source.split("\n")[selection.start.line] ?? "").slice(
                  selection.start.character,
                  selection.end.character,
                ),
              )
              .catch(() => undefined)
          : undefined;
        const declared = sliced
          ? undefined
          : await declarationAtPosition({
              workspace: input.workspace,
              uri,
              position: selection.start,
            }).catch(() => undefined);
        return {
          file: displayPath(uri, root),
          selection,
          // Named only when it differs from the selection: repeating an
          // identifier's own span costs a second read to learn nothing.
          extent: sameRange(extent, selection) ? undefined : extent,
          // A name is an identifier. An overload signature's selection spans
          // the whole signature line, and the slice of it is a listing, not
          // a name — 74 characters of Effect's filter overload stood where
          // "filter" belonged.
          name:
            (sliced && /^[$A-Za-z_][\w$]*$/u.test(sliced) ? sliced : undefined) ?? declared?.name,
        };
      }),
    ),
  };
};
