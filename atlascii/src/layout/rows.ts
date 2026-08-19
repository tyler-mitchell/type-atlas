import { type Config, resolve } from "../config/index.ts";
import { type Branch, hierarchy } from "./hierarchy.ts";

/**
 * Rows carrying only the facts that apply, nested by structure.
 *
 * An entry holds its own children, so a caller passes the tree it already has —
 * an outline, a selection chain — instead of flattening it and computing a
 * depth per row. Depth is a property of where a row sits, which the hierarchy
 * works out.
 *
 * `notes` sit against the name with a space, because they continue it: a
 * completion and its type read as one phrase. `fields` are separately
 * meaningful and take the separator, because each is its own fact about the
 * row. A row wanting both gets `name note · field · field — detail`.
 *
 * Notes and fields are appended only when they say something: a document layer
 * hands through nulls where a caller wrote nothing, and `null` is not a fact
 * about a row.
 */
export type Row = {
  readonly name: string;
  readonly marker?: string;
  /** What the thing is, set apart from its name the way every kind is. */
  readonly kind?: string;
  readonly notes?: readonly (string | null | undefined)[];
  readonly fields?: readonly (string | null | undefined)[];
  readonly detail?: string;
  readonly children?: readonly Row[];
};

/**
 * Rows as branches, labels composed.
 *
 * Separate from `rows` because depth can be drawn more than one way, and which
 * one a reader gets is a presentation choice that should not fork the data
 * model with it. The composed label is the same under every guide; only what
 * precedes it changes.
 */
export const rowBranches = (entries: readonly Row[], config?: Config): readonly Branch[] => {
  const { marks } = resolve(config);
  const branch = (row: Row): Branch => ({
    label: [
      [
        row.marker,
        row.kind === undefined
          ? row.name
          : `${row.name} ${marks.kindOpen}${row.kind}${marks.kindClose}`,
        ...(row.notes ?? []).filter(Boolean),
      ]
        .filter(Boolean)
        .join(" "),
      ...(row.fields ?? []).filter(Boolean),
    ]
      .join(marks.separator)
      .concat(row.detail === undefined ? "" : `${marks.detail}${row.detail}`),
    children: (row.children ?? []).map(branch),
  });
  return entries.map(branch);
};

export const rows = (entries: readonly Row[], config?: Config): readonly string[] =>
  hierarchy({ branches: rowBranches(entries, config), guide: resolve(config).guide });
