/**
 * The punctuation that joins fields together.
 *
 * Neither words nor glyphs, which is why it sits beside them rather than in
 * them: a mark is not translated (a separator means the same in every
 * language) and does not depend on what a terminal can draw (they are ASCII).
 * They are format convention — the difference between `name [kind] 1:1` and
 * `name (kind) 1:1` — and a consumer matching an existing log format needs to
 * set them without touching the other two.
 *
 * Collected here because they were scattered across a dozen components as
 * inline string literals, where no one could see the set or change it.
 */
export type Marks = {
  /** Between fields that are separately meaningful: `name · kind`. */
  readonly separator: string;
  /** Between a location and the source text at it: `12:7:  const x`. */
  readonly sourceGap: string;
  /** Around a symbol's kind: `name [function]`. */
  readonly kindOpen: string;
  readonly kindClose: string;
  /** Before a trailing explanation: `name — what it is`. */
  readonly detail: string;
  /** Between items of one field: `1:1, 4:2`. */
  readonly listJoin: string;
  /** Between counted states: `2 failed | 6 passed`. */
  readonly countJoin: string;
  /** Around a total: `(8)`. */
  readonly totalOpen: string;
  readonly totalClose: string;
  /** One level of indentation, where a guide is not what decides it. */
  readonly indent: string;
  /** The code frame's gutter and its caret. */
  readonly gutter: string;
  readonly caret: string;
  /**
   * A unified diff's line markers.
   *
   * Convention rather than language — every diff reader knows `-` and `+`, and
   * a translator would leave them alone — which is what puts them here beside
   * the other punctuation instead of in the message catalog with `Expected`.
   */
  readonly diffRemoved: string;
  readonly diffAdded: string;
  readonly diffCommon: string;
  /**
   * The boundary between the parts of a diff that are shown.
   *
   * `@@` is what a unified diff puts where it stopped printing unchanged lines,
   * so a reader already knows the line they are looking at is a gap rather than
   * content. What follows it here is a count rather than GNU's line ranges,
   * because chunks arrive without line numbers to state.
   */
  readonly diffHunk: string;
  /**
   * A containment trail, and what sets a channel apart from the trail it labels.
   *
   * `a > b > c` is the conventional shape for "b inside a", which is what a
   * symbol path, a suite path, and a call trail all are.
   */
  readonly trail: string;
  readonly channel: string;
  /**
   * What encloses a banner: the name of something a reader reads *through*.
   *
   * A heading says a section starts here; a banner says everything below
   * belongs to this until the next one. A file's contents, a package's
   * surface, and a symbol's report are all the second kind, and a reader
   * scanning several needs to see where one ends without counting blank lines.
   */
  readonly bannerOpen: string;
  readonly bannerClose: string;
};

export const defaultMarks: Marks = {
  separator: " · ",
  sourceGap: ":  ",
  kindOpen: "[",
  kindClose: "]",
  detail: " — ",
  listJoin: ", ",
  countJoin: " | ",
  totalOpen: " (",
  totalClose: ")",
  indent: "  ",
  gutter: "|",
  caret: "^",
  diffRemoved: "-",
  diffAdded: "+",
  diffCommon: " ",
  diffHunk: "@@",
  trail: " > ",
  channel: " | ",
  bannerOpen: "=== ",
  bannerClose: " ===",
};

/**
 * Marks restricted to ASCII, for the same consumers `asciiFigures` serves.
 *
 * Only the two that are not already ASCII change — the em dash and the middle
 * dot — so a caller wanting plain output does not have to restate the rest.
 */
export const asciiMarks: Marks = {
  ...defaultMarks,
  separator: " - ",
  detail: " -- ",
};
