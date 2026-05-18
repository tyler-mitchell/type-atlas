import path from "node:path";
import {
  type CodeMapping,
  type LanguagePlugin,
  type VirtualCode,
} from "@volar/language-core";
import type { TypeScriptExtraServiceScript } from "@volar/typescript";
import {
  parseFeatureDocument,
  type FeatureCodeBlock,
  type FeatureDocument,
} from "@featuretype/core";
import type * as ts from "typescript";
import { URI } from "vscode-uri";

export function createFeatureTypeLanguagePlugin(): LanguagePlugin<URI> {
  return {
    getLanguageId(uri) {
      if (uri.path.endsWith(".featuretype")) {
        return "featuretype";
      }
    },

    createVirtualCode(uri, languageId, snapshot) {
      if (languageId === "featuretype") {
        return new FeatureTypeVirtualCode(uri, snapshot);
      }
    },

    updateVirtualCode(_uri, virtualCode, snapshot) {
      if (virtualCode instanceof FeatureTypeVirtualCode) {
        virtualCode.update(snapshot);
        return virtualCode;
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
          fileName: getServiceScriptFileName(fileName, code),
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
  ) {
    this.mappings = [createIdentityMapping(snapshot.getLength())];
    this.document = parseFeatureDocument({
      filePath: uri.fsPath,
      source: snapshot.getText(0, snapshot.getLength()),
    });
    this.embeddedCodes = this.document.codeBlocks.map(
      (codeBlock) => new FeatureCodeVirtualCode(codeBlock),
    );
  }

  update(snapshot: ts.IScriptSnapshot) {
    this.snapshot = snapshot;
    this.mappings = [createIdentityMapping(snapshot.getLength())];
    this.document = parseFeatureDocument({
      filePath: this.uri.fsPath,
      source: snapshot.getText(0, snapshot.getLength()),
    });
    this.embeddedCodes = this.document.codeBlocks.map(
      (codeBlock) => new FeatureCodeVirtualCode(codeBlock),
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

  constructor(public readonly codeBlock: FeatureCodeBlock) {
    this.id = codeBlock.id;
    this.languageId =
      codeBlock.language === "tsx" ? "typescriptreact" : "typescript";
    this.generatedCode = codeBlock.code;
    this.mappings = [
      createMapping(codeBlock.range.contentStart, 0, codeBlock.code.length),
    ];
    this.snapshot = createSnapshot(this.generatedCode);
  }
}

function getServiceScriptFileName(
  sourceFileName: string,
  code: FeatureCodeVirtualCode,
) {
  return code.codeBlock.fileName ??
    path.join(
      path.dirname(sourceFileName),
      `${path.basename(sourceFileName)}.${code.id}${getScriptExtension(code.codeBlock.language)}`,
    );
}

function getScriptExtension(language: FeatureCodeBlock["language"]) {
  return language === "tsx" ? ".tsx" : ".ts";
}

function getScriptKind(language: FeatureCodeBlock["language"]) {
  return language === "tsx" ? 4 : 3;
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
