import Markdoc from "@markdoc/markdoc";

// Markdoc ships CommonJS; its values are on the default export.
const { Tag } = Markdoc;

/**
 * Builders for the Markdoc nodes components return.
 *
 * Components emit Markdoc's own vocabulary rather than a layout language of
 * this library's invention, and these are the three shapes they need. Keeping
 * them here means a component never constructs a `Tag` directly, and the
 * renderer has one small set of names to implement.
 */

/** A block. Blocks stand apart from each other. */
export const paragraph = (children: readonly unknown[]) => new Tag("p", {}, children as never[]);

/** A container whose children are separated by a blank line. */
export const blocks = (children: readonly unknown[]) =>
  new Tag("article", {}, children as never[]);

/** A heading at a level. */
export const heading = (level: number, text: string) =>
  new Tag(`h${level}`, {}, [text] as never[]);

/**
 * Lines stacked inside one block, joined by Markdoc's own line break.
 *
 * Not a list: a list means a list, and borrowing one for plain stacking would
 * put markers on output that is not a list — and strip them from authored lists
 * that are.
 */
export const stack = (lines: readonly unknown[]) =>
  new Tag(
    "p",
    {},
    lines.flatMap((line, index) =>
      index === 0 ? [line] : [new Tag("br", {}, []), line],
    ) as never[],
  );
