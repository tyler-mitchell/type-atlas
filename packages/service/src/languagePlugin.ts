import {
  type CodeMapping,
  type LanguagePlugin,
  type VirtualCode,
} from "@volar/language-core";
import type { TypeScriptExtraServiceScript } from "@volar/typescript";
import {
  defaultFeatureDocumentSchema,
  parseFeatureDocument,
  type FeatureCodeBlock,
  type FeatureDocument,
  type FeatureDocumentSchema,
} from "@featuretype/core";
import type * as ts from "typescript";
import { URI } from "vscode-uri";

export function createFeatureTypeLanguagePlugin(options: {
  schema?: FeatureDocumentSchema;
} = {}): LanguagePlugin<URI> {
  const schema = options.schema ?? defaultFeatureDocumentSchema;

  return {
    getLanguageId(uri) {
      if (uri.path.endsWith(".featuretype")) {
        return "featuretype";
      }
    },

    createVirtualCode(uri, languageId, snapshot) {
      if (languageId === "featuretype") {
        return new FeatureTypeVirtualCode(uri, snapshot, schema);
      }
    },

    typescript: {
      extraFileExtensions: [
        {
          extension: "featuretype",
          isMixedContent: true,
          scriptKind: 7,
        },
      ],
      getServiceScript() {
        return undefined;
      },

      getExtraServiceScripts(fileName, root) {
        if (!(root instanceof FeatureTypeVirtualCode)) {
          return [];
        }

        return root.embeddedCodes.map<TypeScriptExtraServiceScript>((code) => ({
          fileName: `${fileName}.${code.id}${getScriptExtension(code.codeBlock.language)}`,
          code,
          extension: getScriptExtension(code.codeBlock.language),
          scriptKind: getScriptKind(code.codeBlock.language),
        }));
      },
    },
  };
}

export const featureTypeLanguagePlugin = createFeatureTypeLanguagePlugin();

export class FeatureTypeVirtualCode implements VirtualCode {
  id = "root";
  languageId = "featuretype";
  mappings: CodeMapping[];
  embeddedCodes: FeatureCodeVirtualCode[];
  document: FeatureDocument;

  constructor(
    public readonly uri: URI,
    public snapshot: ts.IScriptSnapshot,
    schema: FeatureDocumentSchema = defaultFeatureDocumentSchema,
  ) {
    this.mappings = [createIdentityMapping(snapshot.getLength())];
    this.document = parseFeatureDocument({
      filePath: uri.fsPath,
      source: snapshot.getText(0, snapshot.getLength()),
      schema,
    });
    this.embeddedCodes = this.document.codeBlocks.map(
      (codeBlock) => new FeatureCodeVirtualCode(this.document, codeBlock),
    );
  }
}

export class FeatureCodeVirtualCode implements VirtualCode {
  readonly languageId: "typescript" | "typescriptreact";
  readonly embeddedCodes: VirtualCode[] = [];
  readonly mappings: CodeMapping[];
  readonly generatedCode: string;
  readonly snapshot: ts.IScriptSnapshot;
  readonly id: string;

  constructor(
    document: FeatureDocument,
    public readonly codeBlock: FeatureCodeBlock,
  ) {
    this.id = `${codeBlock.name}_${sanitizeId(codeBlock.id)}`;
    this.languageId =
      codeBlock.language === "tsx" ? "typescriptreact" : "typescript";

    const setupContent = document.setup?.content ?? "";
    const setupPrefix = setupContent.length > 0 ? `${setupContent}\n\n` : "";
    const wrappedCode = createGeneratedCode(document.slug, codeBlock, setupPrefix);
    const contentOffset = getGeneratedContentOffset(setupPrefix, document.slug, codeBlock);

    this.generatedCode = wrappedCode;

    const mappings: CodeMapping[] = [];

    if (setupContent.length > 0 && document.setup) {
      mappings.push(
        createMapping(
          document.setup.range.contentStart,
          0,
          setupContent.length,
        ),
      );
    }

    mappings.push(
      createMapping(
        codeBlock.range.contentStart,
        contentOffset,
        codeBlock.code.length,
      ),
    );

    this.mappings = mappings;
    this.snapshot = createSnapshot(this.generatedCode);
  }
}

function createGeneratedCode(
  slug: string,
  codeBlock: FeatureCodeBlock,
  setupPrefix: string,
) {
  if (codeBlock.codeShape === "module") {
    return [setupPrefix, codeBlock.code, ""].join("");
  }

  const wrapperPrefix = [
    `export function ${createCodeBlockFunctionName(slug, codeBlock.name, codeBlock.id)}() {`,
    "  return (",
    "    <>",
  ].join("\n");
  const wrapperSuffix = ["    </>", "  );", "}"].join("\n");

  return [
    setupPrefix,
    wrapperPrefix,
    codeBlock.code,
    wrapperSuffix,
    "",
  ].join("\n");
}

function getGeneratedContentOffset(
  setupPrefix: string,
  slug: string,
  codeBlock: FeatureCodeBlock,
) {
  if (codeBlock.codeShape === "module") {
    return setupPrefix.length;
  }

  const wrapperPrefix = [
    `export function ${createCodeBlockFunctionName(slug, codeBlock.name, codeBlock.id)}() {`,
    "  return (",
    "    <>",
  ].join("\n");
  return setupPrefix.length + wrapperPrefix.length + 1;
}

function createCodeBlockFunctionName(
  slug: string,
  blockName: string,
  blockId: string,
) {
  return `FeatureType_${sanitizeId(slug)}_${sanitizeId(blockName)}_${sanitizeId(blockId)}`;
}

function getScriptExtension(language: FeatureCodeBlock["language"]) {
  return language === "tsx" ? ".tsx" : ".ts";
}

function getScriptKind(language: FeatureCodeBlock["language"]) {
  return language === "tsx" ? 4 : 3;
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]+/g, "_");
  return sanitized.length > 0 ? sanitized : "example";
}

function createSnapshot(text: string): ts.IScriptSnapshot {
  return {
    getText(start: number, end: number) {
      return text.slice(start, end);
    },
    getLength() {
      return text.length;
    },
    getChangeRange(_oldSnapshot: ts.IScriptSnapshot) {
      return undefined;
    },
  };
}

function createIdentityMapping(length: number): CodeMapping {
  return createMapping(0, 0, length);
}

function createMapping(
  sourceOffset: number,
  generatedOffset: number,
  length: number,
): CodeMapping {
  return {
    sourceOffsets: [sourceOffset],
    generatedOffsets: [generatedOffset],
    lengths: [length],
    data: {
      completion: true,
      format: true,
      navigation: true,
      semantic: true,
      structure: true,
      verification: true,
    },
  };
}
