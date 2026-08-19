import { padEnd, padStart, width } from "../text/width.ts";

/**
 * A table whose columns are as wide as their widest cell.
 *
 * Generalised from Vitest's benchmark table (`computeBenchColumnWidths`,
 * `padBenchRow`), which measures every row before printing any so the columns
 * line up — the only way to align a column whose contents are not known in
 * advance.
 *
 * Numbers read right-aligned and names read left-aligned, so alignment is per
 * column rather than a single setting. Widths count terminal columns, so a
 * table of paths in any script still lines up.
 */
export type Column = {
  readonly heading?: string;
  readonly align?: "start" | "end";
};

export const columnWidths = (rows: readonly (readonly string[])[], columns: readonly Column[]) =>
  columns.map((column, index) =>
    rows.reduce(
      (widest, row) => Math.max(widest, width(row[index] ?? "")),
      width(column.heading ?? ""),
    ),
  );

export const tableRows = (input: {
  readonly rows: readonly (readonly string[])[];
  readonly columns: readonly Column[];
  readonly gap?: number;
}) => {
  const widths = columnWidths(input.rows, input.columns);
  const gap = " ".repeat(input.gap ?? 2);
  const line = (cells: readonly string[]) =>
    input.columns
      .map((column, index) => {
        const cell = cells[index] ?? "";
        const to = widths[index] ?? 0;
        return column.align === "end"
          ? padStart({ value: cell, columns: to })
          : padEnd({ value: cell, columns: to });
      })
      .join(gap)
      .trimEnd();
  const headings = input.columns.map((column) => column.heading ?? "");
  return [...(headings.some(Boolean) ? [line(headings)] : []), ...input.rows.map(line)];
};
