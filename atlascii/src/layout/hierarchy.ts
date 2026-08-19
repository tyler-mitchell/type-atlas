/**
 * A labelled hierarchy, and the separate question of how depth is drawn.
 *
 * Nearly every component in this library renders the same shape: a label with
 * things beneath it. A file with the references in it, a call with the
 * callables it reaches, a change with the files it touched, an outline with its
 * nested declarations. They differ only in how a reader is shown that something
 * is *beneath* something else — indentation, a marker, or connectors.
 *
 * So the structure is one thing and the guide is another. A component supplies
 * branches; a guide decides what precedes each label. Adding a presentation
 * means writing a guide, not another traversal, and a component that wants tree
 * connectors instead of indentation changes one argument.
 *
 * Headless in the sense that matters: nothing here knows what a file or a
 * symbol is, and nothing here produces Markdoc nodes.
 */

import { defaultDimensions } from "../config/dimensions.ts";
import { type Figures, figures } from "../config/figures.ts";

export type Branch = {
  readonly label: string;
  readonly children?: readonly Branch[];
};

/**
 * What precedes a label.
 *
 * `trail` says, for each ancestor, whether it was the last among its siblings —
 * which is exactly what connector drawing needs to know to decide between a
 * vertical bar and a blank. An indent guide ignores it; a connector guide
 * cannot be written without it.
 */
export type Guide = (position: {
  readonly depth: number;
  readonly last: boolean;
  readonly trail: readonly boolean[];
}) => {
  /** Precedes the label's first line. */
  readonly first: string;
  /**
   * Precedes every line after it.
   *
   * A label can wrap — a type signature is the common case — and a continuation
   * that started at column zero would read as a sibling rather than as more of
   * the same node. Under connectors it is the vertical bar that keeps a wrapped
   * label inside its own branch.
   */
  readonly rest: string;
};

/** Depth as plain indentation. */
export const indentGuide =
  (width = defaultDimensions.indentWidth): Guide =>
  ({ depth }) => ({
    first: " ".repeat(depth * width),
    // One level deeper than the label it continues, always — including at the
    // root, where a guide draws nothing and a wrapped line would otherwise
    // start exactly where the next entry starts. A multi-line signature in a
    // flat list is the common case, and unindented it reads as two entries.
    rest: " ".repeat((depth + 1) * width),
  });

/**
 * Depth as a marker per level, indented under its parent.
 *
 * `marks` is read by depth; the last one repeats, so two marks cover any depth.
 */
export const markerGuide =
  (input: { readonly marks: readonly string[]; readonly width?: number }): Guide =>
  ({ depth }) => {
    const width = input.width ?? defaultDimensions.indentWidth;
    if (depth === 0) return { first: "", rest: " ".repeat(width) };
    const pad = " ".repeat(depth * width);
    const mark = input.marks[Math.min(depth - 1, input.marks.length - 1)];
    const lead = mark ? `${mark} ` : "";
    return { first: `${pad}${lead}`, rest: `${pad}${" ".repeat(lead.length)}` };
  };

/**
 * Depth as box-drawing connectors.
 *
 * An ancestor that was last among its siblings leaves blank space below it; one
 * that was not leaves a vertical bar, so a reader can follow a line up to the
 * parent rather than counting columns.
 */
export const connectorParts = (glyphs: Figures = figures) => ({
  middle: `${glyphs.treeBranch} `,
  end: `${glyphs.treeEnd} `,
  vertical: `${glyphs.treeVertical} `,
  blank: `${glyphs.treeBlank} `,
});

export const connectorGuide = (parts = connectorParts()): Guide => {
  return ({ depth, last, trail }) => {
    if (depth === 0) return { first: "", rest: parts.blank };
    // Ancestors from the first *nested* level: a root has no parent line to
    // connect to, so it draws no trunk beneath itself, and its children start
    // at the connector rather than indented under nothing.
    const ancestors = trail
      .slice(1, -1)
      .map((ancestorLast) => (ancestorLast ? parts.blank : parts.vertical))
      .join("");
    return {
      first: `${ancestors}${last ? parts.end : parts.middle}`,
      rest: `${ancestors}${last ? parts.blank : parts.vertical}`,
    };
  };
};

/** Renders branches to lines, one per label, depth drawn by the guide. */
export const hierarchy = (input: {
  readonly branches: readonly Branch[];
  readonly guide?: Guide;
}): readonly string[] => {
  const guide = input.guide ?? indentGuide();
  const walk = (
    nodes: readonly Branch[],
    depth: number,
    trail: readonly boolean[],
  ): readonly string[] =>
    nodes.flatMap((node, index) => {
      const last = index === nodes.length - 1;
      const here = [...trail, last];
      const { first, rest } = guide({ depth, last, trail: here });
      const [head = "", ...wrapped] = node.label.split("\n");
      return [
        `${first}${head}`,
        ...wrapped.map((line) => `${rest}${line}`),
        ...walk(node.children ?? [], depth + 1, here),
      ];
    });
  return walk(input.branches, 0, []);
};
