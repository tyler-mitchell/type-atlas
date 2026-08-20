import type { Config } from "@markdoc/markdoc";
import { breadcrumb } from "../layout/breadcrumb.ts";
import { defaultMarks } from "../config/marks.ts";
import { figures } from "../config/figures.ts";
import { symbolKind } from "../protocol/kinds.ts";
import { markupText } from "../protocol/markup.ts";
import { type Position, positionText, type Range, rangeText } from "../protocol/range.ts";
import { withArticle } from "../text/article.ts";
import { formatTime } from "../text/time.ts";
import { width } from "../text/width.ts";
import { slash } from "../protocol/uri.ts";

/**
 * Functions transform one value into another. Everything else is a tag.
 *
 * Markdoc passes function arguments positionally, so a function taking several
 * of them reads as `noun(1, "ref", "refs")` at the call site — three unlabelled
 * values whose order a reader has to remember. A tag names its attributes, so
 * anything needing more than one input is a tag, even when what it returns is a
 * value rather than a block.
 *
 * That leaves functions with exactly one argument each, which is the whole rule.
 */
/**
 * The single argument, however little of it arrived.
 *
 * Validation calls these transforms too, and it calls them without the argument
 * object a render supplies — so reaching straight into `Object.values` fails
 * before a document has rendered anything.
 */
const argument = (parameters?: Record<string, unknown>) =>
  parameters === undefined || parameters === null ? undefined : Object.values(parameters)[0];

/**
 * A function of one value, total over what a document can actually pass.
 *
 * `{% if %}` does not guard the calls inside it: Markdoc resolves a node's
 * attributes before deciding whether that node renders, so a function written
 * under a condition still runs when the condition is false. Absent input
 * therefore renders as nothing rather than throwing, and a document is free to
 * write `{% fraction($callers) %}` under `{% if $callers %}`.
 */
const of = <Argument, Result>(apply: (value: Argument) => Result) => ({
  transform: (parameters?: Record<string, unknown>) => {
    const value = argument(parameters);
    return value === undefined || value === null ? "" : apply(value as Argument);
  },
});

/**
 * A function whose answer is a condition, so absence has to stay false rather
 * than becoming the empty string every other function returns for it — Markdoc
 * counts `""` as true.
 */
const asks = <Argument>(apply: (value: Argument) => boolean) => ({
  transform: (parameters?: Record<string, unknown>) => apply(argument(parameters) as Argument),
});

export const functions: Config["functions"] = {
  /**
   * A containment trail: `a > b > c`.
   *
   * Takes the names alone, which is all a document has when it is walking a
   * path out of its own data, or the full shape when a caller has a file to put
   * in front of them.
   */
  breadcrumb: of((value: readonly string[] | Parameters<typeof breadcrumb>[0]) =>
    breadcrumb(
      Array.isArray(value) ? { path: value } : (value as Parameters<typeof breadcrumb>[0]),
    ),
  ),
  /** A protocol range as `line:column-line:column`, counted from one. */
  range: of((value: Range) => rangeText(value)),
  /**
   * A protocol position as `line:column`, counted from one. A value already
   * formatted passes through, so a composer never has to know whether a
   * bind carries the protocol shape or the finished text — `position($x)`
   * and a bare `{% $x %}` agree wherever both are possible.
   */
  position: of((value: Position | string) =>
    typeof value === "string" ? value : positionText(value),
  ),
  /**
   * A protocol symbol kind as the word for it.
   *
   * A document asks for this rather than receiving it already named, so which
   * word stands for kind 12 is a decision the message catalog and the document
   * make between them, not one a handler makes on their behalf.
   */
  symbolKind: of((value: number) => symbolKind(value)),
  /**
   * A glyph by name, so a document can point without hardcoding what points.
   *
   * The set has an ASCII counterpart for terminals that mangle the rest, and a
   * document naming `❯` outright would opt out of it silently.
   */
  figure: of((name: keyof typeof figures) => figures[name] ?? ""),
  /** A word with the English indefinite article that belongs to it. */
  article: of((word: string) => withArticle(word)),
  /** Documentation markup as the text inside it. */
  markup: of((value: Parameters<typeof markupText>[0]) => markupText(value)),
  /** Items as one field: `map, reduce, split`. */
  list: of((value: readonly string[]) => value.join(defaultMarks.listJoin)),
  /**
   * How many of how many, stated only when they differ.
   *
   * `Callers (4)` when everything is shown and `Callers (2/6)` when it is not,
   * so a bound announces itself and an unbounded answer stays quiet.
   */
  fraction: of((value: { readonly shown: number; readonly total: number }) =>
    value.shown === value.total ? String(value.total) : `${value.shown}/${value.total}`,
  ),
  slash: of(slash),
  time: of(formatTime),
  width: of(width),
  /**
   * Markdoc counts every value but `undefined`, `null`, and `false` as true, so
   * an empty array takes an `{% if %}` branch and so does an empty string. A
   * document asking whether there is anything to show has to ask this.
   */
  any: asks((value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(value))),
};
