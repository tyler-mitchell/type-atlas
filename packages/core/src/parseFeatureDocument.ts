import path from "node:path";
import { defaultFeatureDocumentSchema } from "./schema";
import type {
  FeatureBlock,
  FeatureBlockDefinition,
  FeatureBlockRange,
  FeatureCodeBlock,
  FeatureDocument,
  FeatureDocumentSchema,
  FeatureParseError,
  FeatureRange,
} from "./types";

interface ParseFeatureDocumentOptions {
  filePath: string;
  source: string;
  schema?: FeatureDocumentSchema;
}

export function parseFeatureDocument(
  options: ParseFeatureDocumentOptions,
): FeatureDocument {
  const schema = options.schema ?? defaultFeatureDocumentSchema;
  const errors: FeatureParseError[] = [];
  const blocks = parseBlocks({
    source: options.source,
    baseOffset: 0,
    errors,
    definitions: schema.blocks,
  });
  const blocksByName = groupBlocksByName(blocks);
  const allBlocks = flattenBlocks(blocks);
  const documentAnchorRange = createDocumentAnchorRange(options.source);

  validateBlockScope({
    blocks,
    definitions: schema.blocks,
    errors,
    anchorRange: documentAnchorRange,
  });

  const codeBlocks = collectCodeBlocks(blocks);
  const title = firstBlock(blocksByName.title);
  const intent = firstBlock(blocksByName.intent);
  const setup = firstBlock(blocksByName.setup);
  const related = firstBlock(blocksByName.related);
  const examplesSection = firstBlock(blocksByName.examples);
  const examples = codeBlocks.filter(
    (codeBlock) => codeBlock.parentBlockName === "examples" && codeBlock.name === "example",
  );

  validateSetupBlock(setup, errors);

  return {
    filePath: options.filePath,
    source: options.source,
    slug: path.basename(options.filePath, path.extname(options.filePath)),
    displayName:
      normalizeDisplayName(title?.content) ??
      humanizeSlug(path.basename(options.filePath, path.extname(options.filePath))),
    schema,
    blocks,
    blocksByName,
    allBlocks,
    codeBlocks,
    title,
    intent,
    setup,
    related,
    examplesSection,
    examples,
    errors,
  };
}

function parseBlocks(options: {
  source: string;
  baseOffset: number;
  errors: FeatureParseError[];
  definitions: Record<string, FeatureBlockDefinition>;
  parentBlockName?: string;
}): FeatureBlock[] {
  const blocks: FeatureBlock[] = [];
  const openTagPattern = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g;
  let cursor = 0;

  while (cursor < options.source.length) {
    openTagPattern.lastIndex = cursor;
    const match = openTagPattern.exec(options.source);
    if (!match) {
      break;
    }

    const tagName = match[1];
    if (!tagName) {
      break;
    }

    const blockStart = options.baseOffset + (match.index ?? 0);
    const openTagText = match[0];
    const openTagStart = blockStart;
    const openTagEnd = openTagStart + openTagText.length;
    const closeTag = `</${tagName}>`;
    const closeTagStartInSource = options.source.indexOf(closeTag, openTagEnd - options.baseOffset);

    if (closeTagStartInSource === -1) {
      options.errors.push({
        code: "unclosed-block",
        message: `Missing closing tag for <${tagName}>.`,
        severity: "error",
        range: {
          start: openTagStart,
          end: openTagEnd,
        },
      });
      break;
    }

    const closeTagStart = options.baseOffset + closeTagStartInSource;
    const closeTagEnd = closeTagStart + closeTag.length;
    const content = options.source.slice(openTagEnd - options.baseOffset, closeTagStartInSource);
    const definition = options.definitions[tagName];
    const range: FeatureBlockRange = {
      openTagStart,
      openTagEnd,
      contentStart: openTagEnd,
      contentEnd: closeTagStart,
      closeTagStart,
      closeTagEnd,
    };

    const block: FeatureBlock = {
      name: tagName,
      content,
      attributes: parseAttributes(match[2] ?? ""),
      range,
      definition,
      children: [],
      parentBlockName: options.parentBlockName,
    };

    if (!definition) {
      options.errors.push({
        code: "unknown-block",
        message: `Unknown <${tagName}> block. Extend the FeatureType schema before using it.`,
        severity: "warning",
        range: {
          start: openTagStart,
          end: openTagEnd,
        },
      });
    }

    if (definition?.children) {
      block.children = parseBlocks({
        source: content,
        baseOffset: range.contentStart,
        errors: options.errors,
        definitions: definition.children,
        parentBlockName: definition.name,
      });
    }

    blocks.push(block);
    cursor = closeTagEnd - options.baseOffset;
  }

  return blocks;
}

function validateBlockScope(options: {
  blocks: FeatureBlock[];
  definitions: Record<string, FeatureBlockDefinition>;
  errors: FeatureParseError[];
  anchorRange: FeatureRange;
  scopeName?: string;
}) {
  const blocksByName = groupBlocksByName(options.blocks);

  for (const definition of Object.values(options.definitions)) {
    const matchingBlocks = blocksByName[definition.name] ?? [];

    if (definition.cardinality === "single" && matchingBlocks.length > 1) {
      for (const duplicate of matchingBlocks.slice(1)) {
        options.errors.push({
          code: "duplicate-block",
          message: `Only one <${definition.name}> block is allowed.`,
          severity: "error",
          range: {
            start: duplicate.range.openTagStart,
            end: duplicate.range.closeTagEnd,
          },
        });
      }
    }

    if (definition.required && matchingBlocks.length === 0) {
      options.errors.push({
        code: "missing-required-block",
        message:
          options.scopeName
            ? `The <${options.scopeName}> block must declare a <${definition.name}> block.`
            : `FeatureType documents must declare an <${definition.name}> block.`,
        severity: "error",
        range: options.anchorRange,
      });
    }

    for (const block of matchingBlocks) {
      validateRequiredAttributes(block, options.errors, definition);
    }
  }

  for (const block of options.blocks) {
    if (block.definition?.children) {
      validateBlockScope({
        blocks: block.children,
        definitions: block.definition.children,
        errors: options.errors,
        anchorRange: {
          start: block.range.openTagStart,
          end: block.range.closeTagEnd,
        },
        scopeName: block.name,
      });
    }
  }
}

function collectCodeBlocks(blocks: FeatureBlock[]): FeatureCodeBlock[] {
  return blocks.flatMap((block) => {
    const currentCodeBlock =
      block.definition?.emitServiceScript &&
      block.definition.embeddedLanguage &&
      block.definition.codeShape
        ? [
            createCodeBlock({
              block,
              definition: block.definition,
            }),
          ]
        : [];

    return [...currentCodeBlock, ...collectCodeBlocks(block.children)];
  });
}

function createCodeBlock(options: {
  block: FeatureBlock;
  definition: FeatureBlockDefinition;
}): FeatureCodeBlock {
  const id = getStringAttribute(options.block.attributes.id) ?? options.block.name;
  const title =
    getStringAttribute(options.block.attributes.title) ??
    getStringAttribute(options.block.attributes.intent);

  return {
    id,
    name: options.block.name,
    title,
    language: options.definition.embeddedLanguage!,
    codeShape: options.definition.codeShape!,
    code: options.block.content,
    attributes: options.block.attributes,
    range: options.block.range,
    definition: options.definition,
    parentBlockName: options.block.parentBlockName,
  };
}

function validateRequiredAttributes(
  block: FeatureBlock,
  errors: FeatureParseError[],
  definition: FeatureBlockDefinition,
) {
  for (const attribute of definition.requiredAttributes ?? []) {
    if (!(attribute in block.attributes)) {
      errors.push({
        code: "missing-required-attribute",
        message: `Each <${block.name}> block requires a ${attribute} attribute.`,
        severity: "error",
        range: {
          start: block.range.openTagStart,
          end: block.range.openTagEnd,
        },
      });
    }
  }
}

function validateSetupBlock(
  setupBlock: FeatureBlock | undefined,
  errors: FeatureParseError[],
) {
  if (!setupBlock) {
    return;
  }

  const setupLang = getStringAttribute(setupBlock.attributes.lang);
  if (setupLang && setupLang !== "ts" && setupLang !== "tsx") {
    errors.push({
      code: "invalid-setup-lang",
      message: "The <setup> block only supports lang=\"ts\" or lang=\"tsx\".",
      severity: "error",
      range: {
        start: setupBlock.range.openTagStart,
        end: setupBlock.range.openTagEnd,
      },
    });
  }
}

function groupBlocksByName(blocks: FeatureBlock[]) {
  const result: Record<string, FeatureBlock[]> = {};

  for (const block of blocks) {
    result[block.name] ??= [];
    result[block.name].push(block);
  }

  return result;
}

function flattenBlocks(blocks: FeatureBlock[]): FeatureBlock[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(block.children)]);
}

function parseAttributes(rawAttributes: string): Record<string, string | true> {
  const attributes: Record<string, string | true> = {};
  const pattern = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

  for (const match of rawAttributes.matchAll(pattern)) {
    const key = match[1];
    const doubleQuotedValue = match[2];
    const singleQuotedValue = match[3];

    if (!key) {
      continue;
    }

    attributes[key] = doubleQuotedValue ?? singleQuotedValue ?? true;
  }

  return attributes;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function createDocumentAnchorRange(source: string): FeatureRange {
  return {
    start: 0,
    end: Math.min(source.length, 1),
  };
}

function firstBlock(blocks: FeatureBlock[] | undefined) {
  return blocks?.[0];
}

function getStringAttribute(value: string | true | undefined) {
  return typeof value === "string" ? value : undefined;
}
