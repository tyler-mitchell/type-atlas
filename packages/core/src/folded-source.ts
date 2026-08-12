import { type FoldingRange, FoldingRangeKind } from "@volar/language-server/protocol.js";

const minimumViewLines = 20;
const minimumFoldedLines = 6;
const typeDeclaration = /^(?:(?:export|default|declare)\s+)*(?:interface|type)\s+[$_\p{ID_Start}]/u;
const isNonCodeRange = ({ kind }: FoldingRange) =>
  kind === FoldingRangeKind.Comment ||
  kind === FoldingRangeKind.Imports ||
  kind === FoldingRangeKind.Region;

type SourceView = {
  readonly startLine?: number;
  readonly endLine?: number;
  readonly sourceStartLine?: number;
};

/**
 * Renders a stable, line-numbered source view using language-server folding ranges.
 *
 * Source bounds are inclusive and one-based. Short views and type declarations
 * remain expanded; eligible implementation bodies are replaced by placeholders
 * that retain their original line range.
 */
export const formatFoldedSource = (
  source: string,
  ranges: readonly FoldingRange[],
  view: SourceView = {},
): string => {
  const lines = source === "" ? [] : source.replace(/\r?\n$/, "").split(/\r?\n/);
  const sourceStartLine = view.sourceStartLine ?? 1;
  const startLine = view.startLine ?? sourceStartLine;
  const requestedEndLine = view.endLine ?? sourceStartLine + lines.length - 1;
  if (view.endLine !== undefined && startLine > requestedEndLine) {
    throw new Error("startLine must be less than or equal to endLine.");
  }
  if (!lines.length || startLine > sourceStartLine + lines.length - 1) return "";
  const endLine = Math.min(requestedEndLine, sourceStartLine + lines.length - 1);

  const startIndex = startLine - sourceStartLine;
  const viewLineCount = endLine - startLine + 1;
  const width = String(sourceStartLine + lines.length - 1).length;
  const nonCode = ranges.filter(isNonCodeRange);
  const eligible =
    viewLineCount > minimumViewLines
      ? ranges.filter(
          (range) =>
            startIndex <= range.startLine &&
            range.endLine < endLine &&
            !isNonCodeRange(range) &&
            !nonCode.some(
              ({ startLine, endLine }) => startLine <= range.startLine && range.endLine <= endLine,
            ) &&
            !typeDeclaration.test(lines[range.startLine]?.trimStart() ?? "") &&
            range.endLine - range.startLine >= minimumFoldedLines &&
            range.endLine - range.startLine <= viewLineCount / 2,
        )
      : [];
  /**
   * Drops a range that would hide the view's structure when its own children
   * can stand in for it.
   *
   * The outermost eligible range wins at each line, so one long body can
   * swallow every declaration beneath it — a factory's whole returned object
   * collapsed to a single placeholder, hiding the members that are the reason
   * to read the file. Descending is only better when there is something to
   * descend into: a long body containing no foldable children keeps its own
   * placeholder, since discarding it would print every line instead.
   */
  const encloses = (outer: FoldingRange, inner: FoldingRange) =>
    outer !== inner && outer.startLine <= inner.startLine && inner.endLine <= outer.endLine;
  const folds = eligible.filter(
    (range) =>
      range.endLine - range.startLine <= viewLineCount / 3 ||
      !eligible.some((candidate) => encloses(range, candidate)),
  );

  return lines
    .slice(startIndex, endLine)
    .flatMap((text, index) => {
      const line = startIndex + index;
      if (folds.some(({ startLine, endLine }) => startLine < line && line <= endLine)) return [];
      const fold = folds
        .filter(({ startLine }) => startLine === line)
        .reduce<FoldingRange | undefined>(
          (outer, candidate) => (!outer || candidate.endLine > outer.endLine ? candidate : outer),
          undefined,
        );
      const placeholder =
        fold?.collapsedText ?? (fold ? `... ${line + 2}-${fold.endLine + 1}` : undefined);
      const indentation = lines[line + 1]?.match(/^\s*/)?.[0] ?? "";
      return [
        `${String(sourceStartLine + line).padStart(width)}|${text}`,
        ...(placeholder ? [`${" ".repeat(width)}|${indentation}${placeholder}`] : []),
      ];
    })
    .join("\n");
};
