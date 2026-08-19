/**
 * Glyphs for status and structure.
 *
 * Taken from Vitest's `reporters/renderers/figures.ts`. They are single
 * characters that survive a monospace transcript, and each one is doing work
 * that a word would do worse: a reader scans a column of them without reading.
 *
 * Named for what they are, not for what a test runner uses them for — `pass`
 * and `fail` belong to a caller's vocabulary, not to a glyph set.
 */
export type Figures = {
  readonly pointer: string;
  readonly right: string;
  readonly down: string;
  readonly downRight: string;
  readonly dot: string;
  readonly check: string;
  readonly cross: string;
  readonly square: string;
  readonly longDash: string;
  readonly treeBranch: string;
  readonly treeEnd: string;
  readonly treeVertical: string;
  readonly treeBlank: string;
};

export const figures: Figures = {
  pointer: "❯",
  right: "→",
  down: "↓",
  downRight: "↳",
  dot: "·",
  check: "✓",
  cross: "×",
  square: "□",
  longDash: "⎯",
  // One box-drawing glyph each, never three. These are East Asian *Ambiguous*
  // width: a terminal with a CJK font draws them two columns wide, and a part
  // built from three of them then measures six against a sibling part built
  // from one, which measures four. The subtree under a last-child ancestor
  // slid sideways for exactly that reason. One glyph plus plain spaces keeps
  // every part within a column of every other however the terminal resolves
  // them.
  treeBranch: "├ ",
  treeEnd: "└ ",
  treeVertical: "│ ",
  treeBlank: "  ",
};

/**
 * The same set in ASCII, for a terminal that cannot render the above.
 *
 * Not a lesser fallback to be pitied — a transcript piped through a tool that
 * mangles UTF-8, a CI log with a narrow encoding, or a consumer that must emit
 * pure ASCII all need this, and mojibake is worse than a plain hyphen. Every
 * glyph keeps its width so alignment computed against one set holds for the
 * other.
 */
export const asciiFigures: Figures = {
  pointer: ">",
  right: ">",
  down: "v",
  downRight: "\\",
  dot: "*",
  check: "+",
  cross: "x",
  square: "o",
  longDash: "-",
  treeBranch: "|-",
  treeEnd: "`-",
  treeVertical: "| ",
  treeBlank: "  ",
};
