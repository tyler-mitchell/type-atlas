export type FeatureAttributeValue = string | true;

export type FeatureEmbeddedLanguage = "ts" | "tsx";

export interface FeatureRange {
  start: number;
  end: number;
}

export interface FeatureFenceRange {
  fenceStart: number;
  openingFenceEnd: number;
  infoStart: number;
  infoEnd: number;
  metaStart: number;
  metaEnd: number;
  contentStart: number;
  contentEnd: number;
  closingFenceStart?: number;
  closingFenceEnd?: number;
  fenceEnd: number;
}

export interface FeatureParseError {
  code: string;
  message: string;
  severity: "error" | "warning";
  range?: FeatureRange;
}

export interface FeatureFenceAttribute {
  name: string;
  value: FeatureAttributeValue;
  range: FeatureRange;
  valueRange?: FeatureRange;
}

export interface FeatureCodeBlock {
  id: string;
  language: FeatureEmbeddedLanguage;
  code: string;
  file?: string;
  fileName?: string;
  fileRange?: FeatureRange;
  importable: boolean;
  attributes: Record<string, FeatureAttributeValue>;
  attributeRanges: Record<string, FeatureFenceAttribute>;
  info: string;
  meta: string;
  range: FeatureFenceRange;
}

export interface FeatureDocument {
  filePath: string;
  source: string;
  slug: string;
  displayName: string;
  codeBlocks: FeatureCodeBlock[];
  errors: FeatureParseError[];
}
