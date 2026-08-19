import { type Config, resolve } from "../config/index.ts";
import { padStart, width as columnsOf } from "../text/width.ts";

/**
 * Rows of labelled values, aligned on their labels.
 *
 * Adapted from Vitest's `padSummaryTitle`, including its width of 11, which is
 * what lines up the `Test Files` / `Tests` / `Duration` block. Right-aligning
 * the label puts every value on the same column, so a reader compares values
 * down a line rather than hunting for where each one starts.
 *
 * The width is a default rather than a constant: a narrow terminal, or labels
 * longer than Vitest's, needs a different column, and hardcoding one would make
 * that a fork instead of an argument.
 */
export type SummaryRow = {
  readonly label: string;
  readonly value: string;
  readonly width?: number;
};

export const summaryRow = (input: SummaryRow & { readonly config?: Config }) =>
  `${padStart({
    value: input.label,
    columns: input.width ?? resolve(input.config).dimensions.labelWidth,
  })} ${input.value}`;

/**
 * Rows sharing a column.
 *
 * The column is the widest label given unless a caller names one, so a set of
 * rows lines up on its own terms. Measured in columns, not code units — this is
 * the function whose whole purpose is that values line up, and a label in any
 * script has to reach the same one.
 */
export const summary = (input: {
  readonly rows: readonly SummaryRow[];
  readonly config?: Config;
}) => {
  const column = Math.max(
    resolve(input.config).dimensions.labelWidth,
    ...input.rows.map((row) => columnsOf(row.label)),
  );
  return input.rows.map((row) => summaryRow({ ...row, width: row.width ?? column })).join("\n");
};
