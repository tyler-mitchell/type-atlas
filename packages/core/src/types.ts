export type FeatureAttributeValue = string | true;

export type FeatureEmbeddedLanguage = "ts" | "tsx";

export type FeatureCodeShape = "fragment" | "module";

export type FeatureBlockKind = "text" | "code" | "container";

export type FeatureBlockCardinality = "single" | "multiple";

export interface FeatureRange {
  start: number;
  end: number;
}

export interface FeatureBlockRange {
  openTagStart: number;
  openTagEnd: number;
  contentStart: number;
  contentEnd: number;
  closeTagStart: number;
  closeTagEnd: number;
}

export interface FeatureParseError {
  code: string;
  message: string;
  severity: "error" | "warning";
  range?: FeatureRange;
}

export interface FeatureBlockDefinition {
  name: string;
  description: string;
  kind: FeatureBlockKind;
  cardinality: FeatureBlockCardinality;
  required?: boolean;
  requiredAttributes?: string[];
  embeddedLanguage?: FeatureEmbeddedLanguage;
  codeShape?: FeatureCodeShape;
  emitServiceScript?: boolean;
  insertTemplate?: string;
  children?: Record<string, FeatureBlockDefinition>;
}

export interface FeatureDocumentSchema {
  blocks: Record<string, FeatureBlockDefinition>;
}

export interface FeatureBlock {
  name: string;
  content: string;
  attributes: Record<string, FeatureAttributeValue>;
  range: FeatureBlockRange;
  definition?: FeatureBlockDefinition;
  children: FeatureBlock[];
  parentBlockName?: string;
}

export interface FeatureCodeBlock {
  id: string;
  name: string;
  title?: string;
  language: FeatureEmbeddedLanguage;
  codeShape: FeatureCodeShape;
  code: string;
  attributes: Record<string, FeatureAttributeValue>;
  range: FeatureBlockRange;
  definition: FeatureBlockDefinition;
  parentBlockName?: string;
}

export interface FeatureDocument {
  filePath: string;
  source: string;
  slug: string;
  displayName: string;
  schema: FeatureDocumentSchema;
  blocks: FeatureBlock[];
  blocksByName: Record<string, FeatureBlock[]>;
  allBlocks: FeatureBlock[];
  codeBlocks: FeatureCodeBlock[];
  title?: FeatureBlock;
  intent?: FeatureBlock;
  setup?: FeatureBlock;
  related?: FeatureBlock;
  examplesSection?: FeatureBlock;
  examples: FeatureCodeBlock[];
  errors: FeatureParseError[];
}
