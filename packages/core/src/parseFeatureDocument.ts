import fs from "node:fs";
import path from "node:path";
import { parse, postprocess, preprocess } from "micromark";
import type {
  FeatureAttributeValue,
  FeatureCodeBlock,
  FeatureDocument,
  FeatureEmbeddedLanguage,
  FeatureFenceAttribute,
  FeatureParseError,
  FeatureRange,
} from "./types";

interface ParseFeatureDocumentOptions {
  filePath: string;
  source: string;
  fileExists?: (filePath: string) => boolean;
}

type MicromarkPoint = {
  line: number;
  column: number;
  offset: number;
};

type MicromarkToken = {
  type: string;
  start: MicromarkPoint;
  end: MicromarkPoint;
};

type MicromarkEvent = ["enter" | "exit", MicromarkToken, unknown?];

type RawFence = {
  index: number;
  language: FeatureEmbeddedLanguage;
  info: string;
  meta: string;
  attributes: Record<string, FeatureAttributeValue>;
  attributeRanges: Record<string, FeatureFenceAttribute>;
  fileComment?: FeatureFenceAttribute;
  range: FeatureCodeBlock["range"];
  code: string;
};

type ValidatedFence = RawFence & {
  file?: string;
  fileName?: string;
  fileRange?: FeatureRange;
  importable: boolean;
  errors: FeatureParseError[];
};

const SUPPORTED_LANGUAGES = new Set<FeatureEmbeddedLanguage>(["ts", "tsx"]);
const URL_LIKE_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const ATTRIBUTE_PATTERN =
  /([A-Za-z_][A-Za-z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;

export function parseFeatureDocument(
  options: ParseFeatureDocumentOptions,
): FeatureDocument {
  const fileExists = options.fileExists ?? fs.existsSync;
  const rawFences = extractTypeScriptFences(options.source);
  const validatedFences = validateFenceModules({
    sourceFilePath: options.filePath,
    rawFences,
    fileExists,
  });

  return {
    filePath: options.filePath,
    source: options.source,
    slug: path.basename(options.filePath, path.extname(options.filePath)),
    displayName:
      getFirstMarkdownHeading(options.source) ??
      humanizeSlug(path.basename(options.filePath, path.extname(options.filePath))),
    codeBlocks: validatedFences.map(toCodeBlock),
    errors: validatedFences.flatMap((fence) => fence.errors),
  };
}

function extractTypeScriptFences(source: string): RawFence[] {
  const events = postprocess(
    parse().document().write(preprocess()(source, "utf8", true)),
  ) as MicromarkEvent[];

  return events.flatMap((event, index) => {
    const [kind, token] = event;
    if (kind !== "enter" || token.type !== "codeFenced") {
      return [];
    }

    const nextExitIndex = events.findIndex(
      ([exitKind, exitToken], candidateIndex) =>
        candidateIndex > index &&
        exitKind === "exit" &&
        exitToken.type === "codeFenced" &&
        exitToken.start.offset === token.start.offset,
    );
    const fenceEvents = events.slice(
      index,
      nextExitIndex === -1 ? undefined : nextExitIndex + 1,
    );
    const fenceTokens = fenceEvents
      .filter(
        ([eventKind, eventToken]) =>
          eventKind === "enter" && eventToken.type === "codeFencedFence",
      )
      .map(([, eventToken]) => eventToken);
    const openingFence = fenceTokens[0];
    if (!openingFence) {
      return [];
    }

    const infoToken = findEnteredToken(fenceEvents, "codeFencedFenceInfo");
    const language = normalizeLanguage(
      infoToken ? source.slice(infoToken.start.offset, infoToken.end.offset) : "",
    );
    if (!language) {
      return [];
    }

    const metaToken = findEnteredToken(fenceEvents, "codeFencedFenceMeta");
    const closingFence = fenceTokens[1];
    const contentStart = findContentStart(source, openingFence.end.offset);
    const contentEnd = closingFence?.start.offset ?? token.end.offset;
    const infoStart = infoToken?.start.offset ?? openingFence.start.offset;
    const infoEnd = infoToken?.end.offset ?? openingFence.end.offset;
    const metaStart = metaToken?.start.offset ?? infoEnd;
    const metaEnd = metaToken?.end.offset ?? infoEnd;
    const meta = source.slice(metaStart, metaEnd);
    const code = source.slice(contentStart, contentEnd);
    const attributeRanges = parseFenceAttributes(meta, metaStart);

    return [{
      index,
      language,
      info: source.slice(infoStart, infoEnd),
      meta,
      attributes: Object.fromEntries(
        Object.entries(attributeRanges).map(([name, attribute]) => [
          name,
          attribute.value,
        ]),
      ),
      attributeRanges,
      fileComment: parseFirstLineFileComment(code, contentStart),
      range: {
        fenceStart: token.start.offset,
        openingFenceEnd: openingFence.end.offset,
        infoStart,
        infoEnd,
        metaStart,
        metaEnd,
        contentStart,
        contentEnd,
        closingFenceStart: closingFence?.start.offset,
        closingFenceEnd: closingFence?.end.offset,
        fenceEnd: token.end.offset,
      },
      code,
    }];
  });
}

function validateFenceModules(options: {
  sourceFilePath: string;
  rawFences: RawFence[];
  fileExists: (filePath: string) => boolean;
}): ValidatedFence[] {
  const sourceDir = path.dirname(path.resolve(options.sourceFilePath));
  const withPathValidation = options.rawFences.map((fence) =>
    validateFencePath(fence, sourceDir, options.fileExists)
  );
  const duplicateFileNames = collectDuplicateFileNames(withPathValidation);

  return withPathValidation.map((fence) => {
    if (!fence.fileName || !duplicateFileNames.has(fence.fileName)) {
      return fence;
    }

    return {
      ...fence,
      fileName: undefined,
      importable: false,
      errors: [
        ...fence.errors,
        {
          code: "duplicate-fence-file",
          message: `Multiple TypeScript fences declare ${fence.file}. Each importable fence file must be unique.`,
          severity: "error",
          range: getFileDiagnosticRange(fence),
        },
      ],
    };
  });
}

function validateFencePath(
  fence: RawFence,
  sourceDir: string,
  fileExists: (filePath: string) => boolean,
): ValidatedFence {
  const fileComment = fence.fileComment;
  if (!fileComment || typeof fileComment.value !== "string") {
    return {
      ...fence,
      importable: false,
      errors: [],
    };
  }

  const file = fileComment.value;
  const fileRange = getFileDiagnosticRange(fence);
  const extension = path.posix.extname(file);
  const normalizedFile = normalizeFenceFileSpecifier(file);
  const fileName = normalizedFile
    ? path.resolve(sourceDir, normalizedFile.slice(2))
    : undefined;
  const validationError =
    validateRelativeChildSpecifier(file, fileRange) ??
    validateFenceExtension(file, extension, fence.language, fileRange) ??
    validateRealFileShadow(fileName, fileExists, fileRange);

  if (validationError || !fileName) {
    return {
      ...fence,
      file,
      fileRange,
      fileName: undefined,
      importable: false,
      errors: validationError ? [validationError] : [],
    };
  }

  return {
    ...fence,
    file: normalizedFile,
    fileRange,
    fileName,
    importable: true,
    errors: [],
  };
}

function validateRelativeChildSpecifier(
  file: string,
  range: FeatureRange,
): FeatureParseError | undefined {
  if (
    URL_LIKE_PATTERN.test(file) ||
    file.startsWith("//") ||
    file.startsWith("/") ||
    file.startsWith("\\") ||
    path.isAbsolute(file)
  ) {
    return {
      code: "invalid-fence-file",
      message: "Fence file paths must be relative child paths such as module.ts or ./module.ts.",
      severity: "error",
      range,
    };
  }

  if (file.includes("\\") || file.split("/").includes("..")) {
    return {
      code: "invalid-fence-file",
      message: "Fence file paths cannot use parent traversal or backslashes.",
      severity: "error",
      range,
    };
  }
}

function validateFenceExtension(
  file: string,
  extension: string,
  language: FeatureEmbeddedLanguage,
  range: FeatureRange,
): FeatureParseError | undefined {
  const expected = language === "tsx" ? ".tsx" : ".ts";
  if (extension !== expected) {
    return {
      code: "fence-extension-mismatch",
      message: `A \`\`\`${language} fence first-line comment must use ...${expected}.`,
      severity: "error",
      range,
    };
  }
}

function validateRealFileShadow(
  fileName: string | undefined,
  fileExists: (filePath: string) => boolean,
  range: FeatureRange,
): FeatureParseError | undefined {
  if (!fileName || !fileExists(fileName)) {
    return;
  }

  return {
    code: "fence-file-shadows-real-file",
    message: "Fence file paths cannot shadow a real file in the workspace.",
    severity: "error",
    range,
  };
}

function collectDuplicateFileNames(fences: readonly ValidatedFence[]): Set<string> {
  const counts = fences.reduce<Record<string, number>>((result, fence) => {
    if (!fence.fileName) {
      return result;
    }

    return {
      ...result,
      [fence.fileName]: (result[fence.fileName] ?? 0) + 1,
    };
  }, {});

  return new Set(
    Object.entries(counts)
      .filter(([, count]) => count > 1)
      .map(([fileName]) => fileName),
  );
}

function toCodeBlock(fence: ValidatedFence): FeatureCodeBlock {
  return {
    id: createCodeBlockId(fence),
    language: fence.language,
    code: fence.code,
    file: fence.file,
    fileName: fence.fileName,
    fileRange: fence.fileRange,
    importable: fence.importable,
    attributes: fence.attributes,
    attributeRanges: fence.attributeRanges,
    info: fence.info,
    meta: fence.meta,
    range: fence.range,
  };
}

function findEnteredToken(
  events: readonly MicromarkEvent[],
  tokenType: string,
): MicromarkToken | undefined {
  return events.find(
    ([kind, token]) => kind === "enter" && token.type === tokenType,
  )?.[1];
}

function normalizeLanguage(value: string): FeatureEmbeddedLanguage | undefined {
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.has(normalized as FeatureEmbeddedLanguage)
    ? normalized as FeatureEmbeddedLanguage
    : undefined;
}

function findContentStart(source: string, openingFenceEnd: number): number {
  const lineEnding = /(?:\r\n|\r|\n)/.exec(source.slice(openingFenceEnd));
  if (!lineEnding || lineEnding.index !== 0) {
    return openingFenceEnd;
  }

  return openingFenceEnd + lineEnding[0].length;
}

function parseFenceAttributes(
  rawMeta: string,
  baseOffset: number,
): Record<string, FeatureFenceAttribute> {
  return Object.fromEntries(
    [...rawMeta.matchAll(ATTRIBUTE_PATTERN)]
      .map((match) => toFenceAttribute(match, baseOffset))
      .filter((attribute): attribute is FeatureFenceAttribute => Boolean(attribute))
      .map((attribute) => [attribute.name, attribute]),
  );
}

function toFenceAttribute(
  match: RegExpMatchArray,
  baseOffset: number,
): FeatureFenceAttribute | undefined {
  const name = match[1];
  if (!name || match.index === undefined) {
    return;
  }

  const rawText = match[0];
  const doubleQuotedValue = match[2];
  const singleQuotedValue = match[3];
  const unquotedValue = match[4];
  const value = doubleQuotedValue ?? singleQuotedValue ?? unquotedValue ?? true;
  const start = baseOffset + match.index;
  const end = start + rawText.length;
  const stringValue =
    typeof value === "string"
      ? doubleQuotedValue ?? singleQuotedValue ?? unquotedValue
      : undefined;
  const valueIndex =
    stringValue === undefined ? -1 : rawText.indexOf(stringValue);

  const valueRange =
    valueIndex === -1 || stringValue === undefined
      ? undefined
      : {
          start: start + valueIndex,
          end: start + valueIndex + stringValue.length,
        };

  return {
    name,
    value,
    range: { start, end },
    valueRange,
  };
}

function parseFirstLineFileComment(
  code: string,
  contentStart: number,
): FeatureFenceAttribute | undefined {
  const match = /^([ \t]*)\/\/[ \t]*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s\r\n]+))/.exec(code);
  const value = match?.[2] ?? match?.[3] ?? match?.[4];
  if (!match || !value || !isFileCommentCandidate(value)) {
    return;
  }

  const leadingWhitespace = match[1]?.length ?? 0;
  const start = contentStart + match[0].indexOf(value);

  return {
    name: "file",
    value,
    range: {
      start: contentStart + leadingWhitespace,
      end: contentStart + match[0].length,
    },
    valueRange: {
      start,
      end: start + value.length,
    },
  };
}

function isFileCommentCandidate(value: string): boolean {
  return [".ts", ".tsx"].includes(path.posix.extname(value));
}

function normalizeFenceFileSpecifier(file: string): string | undefined {
  if (file.length === 0) {
    return;
  }

  const normalized = path.posix.normalize(file);
  return normalized.startsWith("./") ? normalized : `./${normalized}`;
}

function getFileDiagnosticRange(fence: RawFence): FeatureRange {
  return fence.fileComment?.valueRange ??
    fence.fileComment?.range ?? {
      start: fence.range.contentStart,
      end: fence.range.contentStart,
    };
}

function createCodeBlockId(fence: ValidatedFence): string {
  const base = fence.file ?? `anonymous-${fence.index}`;
  const sanitized = base.replace(/[^a-zA-Z0-9_]+/g, "_");
  return sanitized.length > 0 ? sanitized : `anonymous_${fence.index}`;
}

function getFirstMarkdownHeading(source: string): string | undefined {
  const heading = /^(?:#{1,6})[ \t]+(.+?)\s*#*\s*$/m.exec(source)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : undefined;
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
