/**
 * ASCII components for code intelligence.
 *
 * Data in, lines out. Nothing reachable from this entry point imports a
 * document engine, so a consumer composes these however they like — joined by
 * hand, fed to a template layer of their own, or written straight to a
 * terminal.
 *
 * A document layer is available from `atlascii/document` for callers who want
 * one, and it is the only place a document engine is loaded. Importing it is a
 * choice; importing this is not a commitment to it.
 *
 * The strata, outermost first: components answer a code-intelligence question;
 * protocol turns a language server's values into text; layout arranges lines;
 * text measures and transforms them; format encodes for a machine; config is
 * the words, glyphs, punctuation, and widths all of it reads.
 */

/** What each component is given. A caller shaping data writes one of these. */
export type {
  CallGroup,
  ChangeGroup,
  Diagnostic,
  DiffChunk,
  DocumentSymbol,
  LocationLink,
  LocationNode,
  StackFrame,
  WorkspaceSymbol,
} from "./protocol/shapes.ts";
export { severityNames, type SeverityNames } from "./protocol/shapes.ts";

/** A language server's own values, as text. */
export { diagnosticSeverity, symbolKind } from "./protocol/kinds.ts";
export { markupText } from "./protocol/markup.ts";
export {
  containsPosition,
  type Position,
  positionText,
  type Range,
  rangeText,
  sameRange,
} from "./protocol/range.ts";
export { displayPath, slash } from "./protocol/uri.ts";

/** One answer each: data in, lines out, no document engine anywhere. */
export { changes } from "./components/changes.ts";
export { type CountState, counts } from "./components/counts.ts";
export { diff } from "./components/diff.ts";
export { frames } from "./components/location-links.ts";
export { type RequestTrace, requestCost } from "./components/request-cost.ts";

/** Source as a reader sees it: a window, a fold, a caret. */
export { codeFrame } from "./source/frame.ts";
export {
  foldedSource,
  foldingAffectsView,
  type FoldingRange,
  sourceLines,
  type SourceWindow,
} from "./source/folded.ts";
export {
  lineStartOffset,
  newlineWidth,
  offsetToLine,
  positionToOffset,
} from "./source/offsets.ts";

/** Arranging lines in space, with no domain in them. */
export { breadcrumb } from "./layout/breadcrumb.ts";
export { divider } from "./layout/divider.ts";
export {
  type Branch,
  connectorGuide,
  connectorParts,
  type Guide,
  hierarchy,
  indentGuide,
  markerGuide,
} from "./layout/hierarchy.ts";
export { indented } from "./layout/indent.ts";
export { label, labelPrinter } from "./layout/label.ts";
export { type Row, rowBranches, rows } from "./layout/rows.ts";
export { type SummaryRow, summary, summaryRow } from "./layout/summary.ts";
export { type Column, columnWidths, tableRows } from "./layout/table.ts";

/** Measuring and transforming the text itself. */
export { groupBy, nestByDepth, walk } from "./text/group.ts";
export { formatNumber } from "./text/number.ts";
export { withArticle } from "./text/article.ts";
export { noun, plural, type PluralForms } from "./text/plural.ts";
export {
  breakdown,
  formatTime,
  percent,
  shares,
  type TimedPart,
  timeOfDay,
} from "./text/time.ts";
export { visibleTrailingSpace } from "./text/whitespace.ts";
export { height, padEnd, padStart, truncate, width } from "./text/width.ts";

/** Encoding for something that parses rather than reads. */
export { codexPatch, type PatchFile } from "./format/patch.ts";

/**
 * The one thing every component takes besides its data.
 *
 * A caller passes the namespaces it wants to change and the rest fall back
 * individually, so choosing an ASCII glyph set does not also cost the default
 * words, punctuation, and widths.
 */
export { type Config, configurePresentation, resolve } from "./config/index.ts";
export { type GuideName, guideNames } from "./config/guides.ts";
export { type PathStyle, pathStyles } from "./config/paths.ts";
export { defaultDimensions, type Dimensions, narrowDimensions } from "./config/dimensions.ts";
export { asciiFigures, type Figures, figures } from "./config/figures.ts";
export { asciiMarks, defaultMarks, type Marks } from "./config/marks.ts";
export { defaultMessages, type Messages, translate } from "./config/messages.ts";
