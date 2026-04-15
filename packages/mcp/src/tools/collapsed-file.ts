import type { DiagnosticsSession } from "@featuretype/language-server";
import * as path from "node:path";
import type { FoldingRange } from "vscode-languageserver-protocol";

export const COLLAPSED_FILE_KINDS = ["code", "imports", "comment", "region"] as const;

export type CollapsedFileKind = (typeof COLLAPSED_FILE_KINDS)[number];

export type CollapsedFileRange = {
  startLine: number;
  endLine: number;
  hiddenLineCount: number;
  kind: CollapsedFileKind;
  collapsedText: string;
};

export type CollapsedFileSnapshot = {
  text: string;
  file: string;
  totalLineCount: number;
  visibleLineCount: number;
  collapsedRangeCount: number;
  appliedKinds: CollapsedFileKind[];
  ranges: CollapsedFileRange[];
};

type NormalizedCollapsedRange = CollapsedFileRange & {
  collapsedLabel: string;
  hiddenStartLine: number;
  hiddenEndLine: number;
};

type RenderedLine = {
  sourceLineNumber: number;
  text: string;
};

type RangeNode = {
  index: number;
  parentIndex: number | null;
  depth: number;
  range: NormalizedCollapsedRange;
};

const DEFAULT_COLLAPSED_KINDS: readonly CollapsedFileKind[] = ["code"];
const MIN_COLLAPSIBLE_FILE_LINE_COUNT = 20;
const MIN_COLLAPSIBLE_CODE_HIDDEN_LINE_COUNT = 6;
const MAX_SINGLE_TOP_LEVEL_COLLAPSE_FILE_LINE_COUNT = 80;
const MIN_SINGLE_TOP_LEVEL_COLLAPSE_FILE_SHARE = 0.5;
const MONOLITHIC_RANGE_MIN_HIDDEN_LINE_COUNT = 16;
const MONOLITHIC_RANGE_MIN_FILE_SHARE = 0.45;
const MONOLITHIC_RANGE_MIN_DIRECT_CHILD_COUNT = 2;

function normalizeCollapsedFileKind(
  kind: FoldingRange["kind"] | undefined,
  startLineText: string,
): CollapsedFileKind {
  switch (kind) {
    case "imports":
      return "imports";
    case "comment":
      return "comment";
    case "region":
      return "region";
    default:
      if (startLineText.trimStart().startsWith("import ")) {
        return "imports";
      }
      return "code";
  }
}

function getLeadingWhitespace(line: string): string {
  return line.match(/^\s*/)?.[0] ?? "";
}

function clampLineNumber(line: number, lineCount: number): number {
  return Math.max(0, Math.min(line, Math.max(0, lineCount - 1)));
}

function getMinCollapsibleHiddenLineCount(kind: CollapsedFileKind): number {
  return MIN_COLLAPSIBLE_CODE_HIDDEN_LINE_COUNT;
}

function isCollapsibleRange(range: NormalizedCollapsedRange): boolean {
  return range.hiddenLineCount >= getMinCollapsibleHiddenLineCount(range.kind);
}

function shouldKeepRangeVisible(
  kind: CollapsedFileKind,
  startLineText: string,
): boolean {
  const trimmedLine = startLineText.trim();
  if (kind !== "code") {
    return false;
  }

  return (
    /^(?:export\s+)?interface\b/.test(trimmedLine)
    || /^(?:export\s+)?type\b/.test(trimmedLine)
  );
}

function shouldPreserveClosingLineByDefault(
  kind: CollapsedFileKind,
  startLineText: string,
): boolean {
  if (kind === "comment") {
    return true;
  }

  return startLineText.trim().startsWith("return");
}

function formatLineCountLabel(lineCount: number): string {
  return `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
}

function matchNamedDeclaration(
  line: string,
  pattern: RegExp,
): string | null {
  const match = pattern.exec(line);
  return typeof match?.[1] === "string" && match[1].length > 0 ? match[1] : null;
}

function getCollapsedRangeLabel(
  kind: CollapsedFileKind,
  startLineText: string,
): string {
  const trimmedLine = startLineText.trim();
  if (kind === "comment") {
    return "comment block";
  }
  if (kind === "region") {
    return "region block";
  }

  const namedHookCallbackMatch =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(useCallback|useMemo|useLayoutEffect|useEffect)\s*\(/.exec(
      trimmedLine,
    );
  if (namedHookCallbackMatch) {
    const variableName = namedHookCallbackMatch[1];
    const hookName = namedHookCallbackMatch[2];
    switch (hookName) {
      case "useCallback":
        return `${variableName} callback`;
      case "useMemo":
        return `${variableName} memo`;
      case "useEffect":
      case "useLayoutEffect":
        return `${variableName} effect`;
      default:
        return `${variableName} block`;
    }
  }

  const hookCallbackName = matchNamedDeclaration(
    trimmedLine,
    /\b(useEffect|useMemo|useCallback|useLayoutEffect)\s*\(/,
  );
  if (hookCallbackName) {
    return `${hookCallbackName} callback`;
  }

  const functionName = matchNamedDeclaration(
    trimmedLine,
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/,
  );
  if (functionName) {
    return `${functionName} body`;
  }

  const className = matchNamedDeclaration(
    trimmedLine,
    /\bclass\s+([A-Za-z_$][\w$]*)\b/,
  );
  if (className) {
    return `${className} body`;
  }

  const interfaceName = matchNamedDeclaration(
    trimmedLine,
    /\binterface\s+([A-Za-z_$][\w$]*)\b/,
  );
  if (interfaceName) {
    return `${interfaceName} definition`;
  }

  const typeName = matchNamedDeclaration(
    trimmedLine,
    /\btype\s+([A-Za-z_$][\w$]*)\b/,
  );
  if (typeName) {
    return `${typeName} definition`;
  }

  const variableName = matchNamedDeclaration(
    trimmedLine,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/,
  );
  if (variableName) {
    return `${variableName} block`;
  }

  if (trimmedLine.startsWith("if (")) {
    return "if block";
  }
  if (trimmedLine.startsWith("switch (")) {
    return "switch block";
  }
  if (trimmedLine === "try {" || trimmedLine === "try") {
    return "try block";
  }
  if (trimmedLine.startsWith("catch")) {
    return "catch block";
  }
  if (trimmedLine.startsWith("for (") || trimmedLine.startsWith("while (")) {
    return "loop block";
  }

  if (trimmedLine.startsWith("return")) {
    return "return block";
  }

  return "code block";
}

function createCollapsedText(
  collapsedLabel: string,
  hiddenLineCount: number,
): string {
  return `... // collapsed ${collapsedLabel} (${formatLineCountLabel(hiddenLineCount)})`;
}

function createCollapsedPlaceholder(
  line: RenderedLine | undefined,
  collapsedText: string,
): RenderedLine {
  return {
    sourceLineNumber: line?.sourceLineNumber ?? 1,
    text: `${getLeadingWhitespace(line?.text ?? "")}${collapsedText}`,
  };
}

function isContainedWithin(
  parent: NormalizedCollapsedRange,
  child: NormalizedCollapsedRange,
): boolean {
  return child.startLine > parent.startLine && child.endLine <= parent.endLine;
}

function collectCollapsedRangeCandidates(
  lines: readonly string[],
  foldingRanges: readonly FoldingRange[],
  lineCount: number,
  allowedKinds: ReadonlySet<CollapsedFileKind>,
  preserveClosingLine: boolean | undefined,
): NormalizedCollapsedRange[] {
  return foldingRanges.reduce<NormalizedCollapsedRange[]>((selected, range) => {
      const startLine = clampLineNumber(range.startLine, lineCount);
      const endLine = clampLineNumber(range.endLine, lineCount);
      if (endLine <= startLine) {
        return selected;
      }

      const startLineText = lines[startLine] ?? "";
      const kind = normalizeCollapsedFileKind(range.kind, startLineText);
      if (kind === "imports") {
        return selected;
      }
      if (!allowedKinds.has(kind)) {
        return selected;
      }
      if (shouldKeepRangeVisible(kind, startLineText)) {
        return selected;
      }

      const hiddenStartLine = startLine + 1;
      const preserveFoldClosingLine =
        preserveClosingLine ?? shouldPreserveClosingLineByDefault(kind, startLineText);
      const hiddenEndLine = preserveFoldClosingLine ? endLine - 1 : endLine;
      if (hiddenStartLine > hiddenEndLine) {
        return selected;
      }

      const hiddenLineCount = hiddenEndLine - hiddenStartLine + 1;
      const collapsedLabel = getCollapsedRangeLabel(kind, startLineText);

      return [...selected, {
        startLine,
        endLine,
        hiddenStartLine,
        hiddenEndLine,
        hiddenLineCount,
        collapsedLabel,
        kind,
        collapsedText: createCollapsedText(
          collapsedLabel,
          hiddenLineCount,
        ),
      }];
    }, []);
}

function buildRangeTree(
  ranges: readonly NormalizedCollapsedRange[],
): RangeNode[] {
  return ranges
    .slice()
    .sort((left, right) => {
      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
      }
      return right.endLine - left.endLine;
    })
    .reduce<{
      nodes: RangeNode[];
      stack: RangeNode[];
    }>((state, range, index) => {
      const containingAncestors = state.stack.filter((candidate) =>
        isContainedWithin(candidate.range, range)
      );
      const parent = containingAncestors.at(-1) ?? null;
      const node: RangeNode = {
        index,
        parentIndex: parent?.index ?? null,
        depth: parent ? parent.depth + 1 : 0,
        range,
      };

      return {
        nodes: [...state.nodes, node],
        stack: [...containingAncestors, node],
      };
    }, {
      nodes: [],
      stack: [],
    }).nodes;
}

function dedupeCollapsedRanges(
  ranges: readonly NormalizedCollapsedRange[],
): NormalizedCollapsedRange[] {
  return ranges.filter((range, index, allRanges) =>
    allRanges.findIndex((candidate) =>
      candidate.kind === range.kind
      && candidate.startLine === range.startLine
      && candidate.endLine === range.endLine
      && candidate.hiddenStartLine === range.hiddenStartLine
      && candidate.hiddenEndLine === range.hiddenEndLine
      && candidate.collapsedText === range.collapsedText
    ) === index
  );
}

function getChildNodes(
  nodes: readonly RangeNode[],
  parentIndex: number | null,
): RangeNode[] {
  return nodes.filter((node) => node.parentIndex === parentIndex);
}

function getVisiblePlaceholderRanges(
  ranges: readonly NormalizedCollapsedRange[],
): NormalizedCollapsedRange[] {
  return ranges.filter((range, _, allRanges) =>
    !allRanges.some((candidate) =>
      candidate !== range
      && candidate.hiddenStartLine <= range.hiddenStartLine
      && candidate.hiddenEndLine >= range.hiddenEndLine
      && (
        candidate.hiddenStartLine !== range.hiddenStartLine
        || candidate.hiddenEndLine !== range.hiddenEndLine
      )
    )
  );
}

function disambiguateDuplicateVisibleLabels(
  ranges: readonly NormalizedCollapsedRange[],
): NormalizedCollapsedRange[] {
  const visibleRanges = getVisiblePlaceholderRanges(ranges);
  const visibleLabelCounts = visibleRanges.reduce<Map<string, number>>((counts, range) =>
    counts.set(range.collapsedLabel, (counts.get(range.collapsedLabel) ?? 0) + 1)
  , new Map());

  const visibleRangeOrdinals = visibleRanges.reduce<{
    nextOrdinals: Map<string, number>;
    rangeOrdinals: Map<NormalizedCollapsedRange, number>;
  }>((state, range) => {
    const nextOrdinal = (state.nextOrdinals.get(range.collapsedLabel) ?? 0) + 1;
    state.nextOrdinals.set(range.collapsedLabel, nextOrdinal);
    state.rangeOrdinals.set(range, nextOrdinal);
    return state;
  }, {
    nextOrdinals: new Map(),
    rangeOrdinals: new Map(),
  }).rangeOrdinals;

  return ranges.map((range) => {
    const totalVisibleDuplicates = visibleLabelCounts.get(range.collapsedLabel) ?? 0;
    if (totalVisibleDuplicates <= 1 || !visibleRangeOrdinals.has(range)) {
      return range;
    }

    const ordinal = visibleRangeOrdinals.get(range) ?? 1;
    const collapsedLabel = `${range.collapsedLabel} #${ordinal}`;
    return {
      ...range,
      collapsedLabel,
      collapsedText: createCollapsedText(collapsedLabel, range.hiddenLineCount),
    };
  });
}

function shouldExpandMonolithicRange(
  node: RangeNode,
  totalLineCount: number,
  directChildren: readonly RangeNode[],
): boolean {
  if (node.parentIndex !== null || node.range.kind !== "code") {
    return false;
  }

  if (node.range.hiddenLineCount < MONOLITHIC_RANGE_MIN_HIDDEN_LINE_COUNT) {
    return false;
  }

  if (node.range.hiddenLineCount / Math.max(1, totalLineCount) < MONOLITHIC_RANGE_MIN_FILE_SHARE) {
    return false;
  }

  return directChildren.length >= MONOLITHIC_RANGE_MIN_DIRECT_CHILD_COUNT;
}

function selectCollapsedRanges(
  candidates: readonly NormalizedCollapsedRange[],
  totalLineCount: number,
): NormalizedCollapsedRange[] {
  const nodes = buildRangeTree(candidates);
  const topLevelNodes = getChildNodes(nodes, null);
  const selectedRanges = topLevelNodes.flatMap((node) => {
    const directChildren = getChildNodes(nodes, node.index);
    return shouldExpandMonolithicRange(node, totalLineCount, directChildren)
      ? directChildren
        .map((child) => child.range)
        .filter((range) => isCollapsibleRange(range))
      : isCollapsibleRange(node.range)
        ? [node.range]
        : [];
  });

  const visiblePlaceholderRanges = getVisiblePlaceholderRanges(selectedRanges);
  const singleVisiblePlaceholderRange =
    visiblePlaceholderRanges.length === 1 ? visiblePlaceholderRanges[0] : null;
  const shouldKeepSingleVisiblePlaceholderFileReadable =
    totalLineCount <= MAX_SINGLE_TOP_LEVEL_COLLAPSE_FILE_LINE_COUNT
    && singleVisiblePlaceholderRange !== null
    && singleVisiblePlaceholderRange.kind === "code"
    && singleVisiblePlaceholderRange.hiddenLineCount / Math.max(1, totalLineCount)
      >= MIN_SINGLE_TOP_LEVEL_COLLAPSE_FILE_SHARE;

  return shouldKeepSingleVisiblePlaceholderFileReadable
    ? []
    : disambiguateDuplicateVisibleLabels(selectedRanges);
}

function normalizeCollapsedRanges(
  lines: readonly string[],
  foldingRanges: readonly FoldingRange[],
  lineCount: number,
  allowedKinds: ReadonlySet<CollapsedFileKind>,
  preserveClosingLine: boolean | undefined,
): NormalizedCollapsedRange[] {
  if (lineCount <= MIN_COLLAPSIBLE_FILE_LINE_COUNT) {
    return [];
  }

  return selectCollapsedRanges(
    dedupeCollapsedRanges(
      collectCollapsedRangeCandidates(
        lines,
        foldingRanges,
        lineCount,
        allowedKinds,
        preserveClosingLine,
      ),
    ),
    lineCount,
  );
}

function renderCollapsedText(
  lines: readonly string[],
  ranges: readonly NormalizedCollapsedRange[],
  lineNumbers: boolean,
): { text: string; visibleLineCount: number } {
  const renderedLines = ranges
    .slice()
    .sort((left, right) => right.hiddenStartLine - left.hiddenStartLine)
    .reduce<RenderedLine[]>((currentLines, range) => {
      const replacementLines = [
        createCollapsedPlaceholder(
          currentLines[range.hiddenStartLine]
            ?? currentLines[range.endLine]
            ?? currentLines[range.startLine],
          range.collapsedText,
        ),
      ];

      return [
        ...currentLines.slice(0, range.hiddenStartLine),
        ...replacementLines,
        ...currentLines.slice(range.hiddenEndLine + 1),
      ];
    }, lines.map((text, index) => ({
      sourceLineNumber: index + 1,
      text,
    })));

  const visibleLines =
    renderedLines.at(-1)?.text === "" ? renderedLines.slice(0, -1) : renderedLines;

  if (!lineNumbers) {
    return {
      text: renderedLines.map((line) => line.text).join("\n"),
      visibleLineCount: visibleLines.length,
    };
  }

  const maxSourceLineNumber = lines.at(-1) === "" ? lines.length - 1 : lines.length;
  const lineNumberWidth = String(maxSourceLineNumber).length;

  return {
    text: visibleLines
      .map(
        (line) => `${String(line.sourceLineNumber).padStart(lineNumberWidth)} │ ${line.text}`,
      )
      .join("\n"),
    visibleLineCount: visibleLines.length,
  };
}

export async function getCollapsedFile(
  session: DiagnosticsSession,
  args: {
    file: string;
    kinds?: CollapsedFileKind[];
    preserveClosingLine?: boolean;
    lineNumbers?: boolean;
  },
): Promise<CollapsedFileSnapshot> {
  const absPath = path.resolve(session.rootDir, args.file);
  const relPath = path.relative(session.rootDir, absPath);

  let content: string;
  try {
    content = session.getFileContent(absPath);
  } catch {
    return {
      text: `File not found: ${args.file}`,
      file: relPath,
      totalLineCount: 0,
      visibleLineCount: 0,
      collapsedRangeCount: 0,
      appliedKinds: args.kinds?.length ? [...args.kinds] : [...DEFAULT_COLLAPSED_KINDS],
      ranges: [],
    };
  }

  const lines = content.split("\n");
  const totalLineCount = content.endsWith("\n") ? lines.length - 1 : lines.length;
  const appliedKinds = args.kinds?.length ? [...args.kinds] : [...DEFAULT_COLLAPSED_KINDS];
  const normalizedRanges = normalizeCollapsedRanges(
    lines,
    await session.getFileFoldingRanges(absPath),
    totalLineCount,
    new Set(appliedKinds),
    args.preserveClosingLine,
  );
  const rendered = renderCollapsedText(
    lines,
    normalizedRanges,
    args.lineNumbers ?? false,
  );

  return {
    text: rendered.text,
    file: relPath,
    totalLineCount,
    visibleLineCount: rendered.visibleLineCount,
    collapsedRangeCount: normalizedRanges.length,
    appliedKinds,
    ranges: normalizedRanges.map((range) => ({
      startLine: range.startLine,
      endLine: range.endLine,
      hiddenLineCount: range.hiddenLineCount,
      kind: range.kind,
      collapsedText: range.collapsedText,
    })),
  };
}
