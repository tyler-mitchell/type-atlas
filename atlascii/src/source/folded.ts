import { type Config, resolve } from "../config/index.ts";
import { translate } from "../config/messages.ts";

export type FoldingRange = {
  readonly startLine: number;
  readonly endLine: number;
  readonly kind?: string;
  readonly collapsedText?: string;
};

export type SourceWindow = {
  readonly startLine?: number;
  readonly endLine?: number;
  readonly sourceStartLine?: number;
};

const typeDeclaration = /^(?:(?:export|default|declare)\s+)*(?:interface|type)\s+[$_\p{ID_Start}]/u;
const dataDeclaration =
  /^(?:(?:export|default|declare)\s+)*(?:const|let|var)\s+[$_\p{ID_Start}][$_\p{ID_Continue}]*\s*(?::[^=]*)?=\s*(?!async\b|function\b|\(|<)\S/u;
const continuation = /^(?:[?:,.)\]}]|=>|&&|\|\||\|\s|\+|-|\*|\?\?)/u;
const nonCodeKinds = new Set(["comment", "imports", "region"]);
const isNonCodeRange = ({ kind }: FoldingRange) => kind !== undefined && nonCodeKinds.has(kind);

export const foldingAffectsView = (viewLineCount: number, config?: Config) =>
  viewLineCount > resolve(config).dimensions.foldThreshold;

export const sourceLines = (source: string): readonly string[] =>
  source === "" ? [] : source.replace(/\r?\n$/, "").split(/\r?\n/);

export const foldedSource = (input: {
  readonly lines: readonly string[];
  readonly ranges: readonly FoldingRange[];
  readonly window?: SourceWindow;
  readonly config?: Config;
}): { readonly text: string; readonly folded: number } => {
  const { lines, ranges } = input;
  const view = input.window ?? {};
  const { marks, messages, dimensions } = resolve(input.config);
  const sourceStartLine = view.sourceStartLine ?? 1;
  const startLine = view.startLine ?? sourceStartLine;
  const requestedEndLine = view.endLine ?? sourceStartLine + lines.length - 1;
  if (view.endLine !== undefined && startLine > requestedEndLine) {
    throw new Error("startLine must be less than or equal to endLine.");
  }
  if (!lines.length || startLine > sourceStartLine + lines.length - 1) {
    return { text: "", folded: 0 };
  }
  const endLine = Math.min(requestedEndLine, sourceStartLine + lines.length - 1);
  const startIndex = startLine - sourceStartLine;
  const viewLineCount = endLine - startLine + 1;
  const width = String(sourceStartLine + lines.length - 1).length;
  const nonCode = ranges.filter(isNonCodeRange);
  const data = ranges.filter(
    (range) =>
      dataDeclaration.test(lines[range.startLine]?.trimStart() ?? "") &&
      range.endLine - range.startLine <= dimensions.foldDataMaximum,
  );
  const eligible =
    viewLineCount > dimensions.foldThreshold
      ? ranges.filter(
          (range) =>
            startIndex <= range.startLine &&
            range.endLine < endLine &&
            !isNonCodeRange(range) &&
            !nonCode.some(
              ({ startLine, endLine }) => startLine <= range.startLine && range.endLine <= endLine,
            ) &&
            !typeDeclaration.test(lines[range.startLine]?.trimStart() ?? "") &&
            !continuation.test(lines[range.startLine]?.trimStart() ?? "") &&
            !data.some(
              ({ startLine, endLine }) => startLine <= range.startLine && range.endLine <= endLine,
            ) &&
            range.endLine - range.startLine >= dimensions.foldMinimumLines &&
            range.endLine - range.startLine <= viewLineCount / 2,
        )
      : [];
  const encloses = (outer: FoldingRange, inner: FoldingRange) =>
    outer !== inner && outer.startLine <= inner.startLine && inner.endLine <= outer.endLine;
  const folds = eligible.filter(
    (range) =>
      range.endLine - range.startLine <= viewLineCount / 3 ||
      !eligible.some((candidate) => encloses(range, candidate)),
  );
  const hidden = (line: number) =>
    folds.some(({ startLine, endLine }) => startLine < line && line <= endLine);
  const folded = lines
    .slice(startIndex, endLine)
    .filter((_, index) => hidden(startIndex + index)).length;
  const text = lines
    .slice(startIndex, endLine)
    .flatMap((text, index) => {
      const line = startIndex + index;
      if (hidden(line)) return [];
      const fold = folds
        .filter(({ startLine }) => startLine === line)
        .reduce<FoldingRange | undefined>(
          (outer, candidate) => (!outer || candidate.endLine > outer.endLine ? candidate : outer),
          undefined,
        );
      const placeholder =
        fold?.collapsedText ??
        (fold
          ? translate({
              key: "fold.placeholder",
              messages,
              values: { from: String(line + 2), to: String(fold.endLine + 1) },
            })
          : undefined);
      const indentation = lines[line + 1]?.match(/^\s*/)?.[0] ?? "";
      return [
        `${String(sourceStartLine + line).padStart(width)} ${marks.gutter} ${text}`.trimEnd(),
        ...(placeholder
          ? [`${" ".repeat(width)} ${marks.gutter} ${indentation}${placeholder}`]
          : []),
      ];
    })
    .join("\n");
  return { text, folded };
};
