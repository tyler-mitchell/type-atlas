/**
 * The numbers a layout is measured against.
 *
 * A fourth kind alongside words, glyphs, and punctuation, for the same reason
 * those three are separate: dimensions answer to something else again — how
 * wide the terminal is, how much context a reader wants, how long a line can be
 * before it stops being worth showing. A narrow terminal changes these and
 * nothing else.
 *
 * Every one of these was a bare number inside the module that used it, where a
 * consumer could neither find nor change it. Several are already accepted as
 * arguments; this is where their defaults live.
 */
export type Dimensions = {
  /** Columns a rule spans when a caller names no width. Vitest's terminal fallback. */
  readonly ruleWidth: number;
  /** Columns a summary label is right-aligned to. Vitest's `padSummaryTitle`. */
  readonly labelWidth: number;
  /** Columns the code frame's line-number gutter occupies. */
  readonly gutterWidth: number;
  /** Lines of context either side of a framed position. */
  readonly frameContext: number;
  /**
   * Past this, a line is treated as machine-generated and the frame is
   * abandoned. A minified file has no frame worth showing, and one very long
   * line is how that announces itself.
   */
  readonly maximumLineLength: number;
  /** Columns a single-line label is cut to before it wraps a row. */
  readonly labelColumns: number;
  /** Columns one level of nesting shifts by. */
  readonly indentWidth: number;
  /** Columns a summarised message is cut to, where the count beside it is what matters. */
  readonly summaryColumns: number;
  /**
   * Lines a view must exceed before any body is folded. A short view is read
   * whole, so folding one costs a reader a request to see what was hidden.
   */
  readonly foldThreshold: number;
  /** Lines a body must span to be worth replacing with a placeholder. */
  readonly foldMinimumLines: number;
  /**
   * Unchanged lines kept either side of a change in a diff.
   *
   * Three is what `diff -u` and every review tool built on it show, so a reader
   * arrives already knowing how much of the surrounding file they are being
   * given. Without a bound a diff prints the whole of both sides: five hundred
   * lines to show that two of them moved.
   */
  readonly diffContext: number;
  /**
   * Lines a data declaration may span and still be shown whole. A table of
   * constants is the content, not an implementation detail hiding behind a
   * signature.
   */
  readonly foldDataMaximum: number;
};

export const defaultDimensions: Dimensions = {
  ruleWidth: 80,
  labelWidth: 11,
  gutterWidth: 3,
  frameContext: 2,
  maximumLineLength: 200,
  labelColumns: 200,
  indentWidth: 2,
  summaryColumns: 96,
  foldThreshold: 20,
  foldMinimumLines: 6,
  diffContext: 3,
  foldDataMaximum: 40,
};

/**
 * Dimensions for a narrow terminal.
 *
 * The rule and the cut shrink; the gutter and the indent do not, because they
 * are structural — a two-column indent is what makes nesting legible at any
 * width, and a narrower one stops reading as nesting at all.
 */
export const narrowDimensions: Dimensions = {
  ...defaultDimensions,
  ruleWidth: 40,
  labelColumns: 80,
};
