import type { FoldingRange } from "@volar/language-server/protocol.js";

const minimumViewLines = 20;
const minimumFoldedLines = 6;
const typeDeclaration = /^(?:(?:export|default|declare)\s+)*(?:interface|type)\s+[$_\p{ID_Start}]/u;

type SourceView = {
  readonly startLine?: number;
  readonly endLine?: number;
};

export const formatFoldedSource = (
  source: string,
  ranges: readonly FoldingRange[],
  view: SourceView = {},
): string => {
  const lines = source === ""
    ? []
    : source.replace(/\r?\n$/, "").split(/\r?\n/);
  const startLine = view.startLine ?? 1;
  const requestedEndLine = view.endLine ?? lines.length;
  if (startLine > requestedEndLine) {
    throw new Error("startLine must be less than or equal to endLine.");
  }
  if (!lines.length || startLine > lines.length) return "";
  const endLine = Math.min(requestedEndLine, lines.length);

  const startIndex = startLine - 1;
  const viewLineCount = endLine - startLine + 1;
  const width = String(lines.length).length;
  const nonCode = ranges.filter(({ kind }) => kind !== undefined);
  const folds = viewLineCount > minimumViewLines
    ? ranges.filter((range) =>
      startIndex <= range.startLine &&
      range.endLine < endLine &&
      range.kind === undefined &&
      !nonCode.some(({ startLine, endLine }) =>
        startLine <= range.startLine && range.endLine <= endLine
      ) &&
      !typeDeclaration.test(lines[range.startLine]?.trimStart() ?? "") &&
      range.endLine - range.startLine >= minimumFoldedLines &&
      range.endLine - range.startLine <= viewLineCount / 2
    )
    : [];

  return lines.slice(startIndex, endLine).flatMap((text, index) => {
    const line = startIndex + index;
    if (
      folds.some(({ startLine, endLine }) =>
        startLine < line && line <= endLine
      )
    ) return [];
    const fold = folds
      .filter(({ startLine }) => startLine === line)
      .reduce<FoldingRange | undefined>(
        (outer, candidate) =>
          !outer || candidate.endLine > outer.endLine ? candidate : outer,
        undefined,
      );
    const placeholder = fold?.collapsedText ??
      (fold ? `... ${line + 2}-${fold.endLine + 1}` : undefined);
    const indentation = lines[line + 1]?.match(/^\s*/)?.[0] ?? "";
    return [
      `${String(line + 1).padStart(width)}|${text}`,
      ...(placeholder
        ? [`${" ".repeat(width)}|${indentation}${placeholder}`]
        : []),
    ];
  }).join("\n");
};
