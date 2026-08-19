/**
 * How depth is drawn — the one axis on which the same information legitimately
 * looks different.
 *
 * A file with the sites in it, a call with what it reaches, an outline with its
 * declarations: all the same shape, a label with things beneath it. What a
 * reader is shown to know something is *beneath* something else is a separate
 * question from what that something is, and it has three established answers:
 *
 *   connectors  `├ └ │`  the branch is drawn, so depth reads at any level
 *   indent      spaces   quietest, and ambiguous once nesting passes one level
 *   markers     `↳ ·`    a glyph per level, for output that must stay narrow
 *
 * This is a fifth configurable namespace beside words, glyphs, punctuation, and
 * numbers, and it is named rather than passed as a function for two reasons.
 * A name survives a markup attribute, so a document can state a variant where
 * one is warranted; and resolving the name here rather than at each call site
 * is what keeps a connector drawn from the same glyph set as everything around
 * it. Before this, every caller built its own guide and passed its own glyphs,
 * so a consumer on the ASCII set still got box drawing from any caller that
 * forgot — and `rows` forgot the indent width too.
 *
 * The line against semantic markers: a guide says *how deep*. When a prefix
 * says *what kind of thing* — the arrow that means "file", the dot that means
 * "key within one" — that is a fact about the row and lives on the row, where
 * it survives whichever guide is in force. Style is config; meaning is data.
 */
import type { Dimensions } from "./dimensions.ts";
import type { Figures } from "./figures.ts";
import {
  connectorGuide,
  connectorParts,
  type Guide,
  indentGuide,
  markerGuide,
} from "../layout/hierarchy.ts";

/**
 * The styles, as one list the type is derived from.
 *
 * A union written by hand needs its values written again wherever something
 * validates them — a host reading a setting, a tag checking an attribute — and
 * a fourth style added to the union would be silently rejected by both. One
 * array, and adding to it reaches everything.
 */
export const guideNames = ["connectors", "indent", "markers"] as const;

export type GuideName = (typeof guideNames)[number];

/**
 * The named guide, built from the glyphs and widths in force around it.
 *
 * A guide is drawn from the same two namespaces the rest of a line is, which
 * is the point of resolving it here: an ASCII consumer gets ASCII connectors
 * without asking, and a narrow terminal gets its indent width, because neither
 * depends on a caller having remembered to thread them through.
 */
export const guideFor = (
  name: GuideName,
  drawn: { readonly figures: Figures; readonly dimensions: Dimensions },
): Guide =>
  ({
    connectors: () => connectorGuide(connectorParts(drawn.figures)),
    indent: () => indentGuide(drawn.dimensions.indentWidth),
    markers: () =>
      markerGuide({
        marks: [drawn.figures.downRight, drawn.figures.dot],
        width: drawn.dimensions.indentWidth,
      }),
  })[name]();
