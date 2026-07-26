import {
  type ClientCapabilities,
  CompletionItemKind,
  type MarkupKind,
  SymbolKind,
  SymbolTag,
} from "vscode-languageserver-protocol";

const markdown: MarkupKind[] = ["markdown", "plaintext"];
const completionItemKinds = Object.values(CompletionItemKind);
const symbolKinds = Object.values(SymbolKind);
const symbolTags = Object.values(SymbolTag);

type ConfigurationValue =
  | boolean
  | string
  | readonly ConfigurationValue[]
  | { readonly [key: string]: ConfigurationValue };

const languageConfiguration = {
  autoClosingTags: true,
  validate: { enable: true },
  suggest: {
    enabled: true,
    completeFunctionCalls: true,
  },
  format: { enable: true },
  inlayHints: {
    parameterNames: {
      enabled: "all",
      suppressWhenArgumentMatchesName: false,
    },
    parameterTypes: { enabled: true },
    variableTypes: {
      enabled: true,
      suppressWhenTypeMatchesName: false,
    },
    propertyDeclarationTypes: { enabled: true },
    functionLikeReturnTypes: { enabled: true },
    enumMemberValues: { enabled: true },
  },
} as const satisfies ConfigurationValue;

const configurations = {
  javascript: languageConfiguration,
  markdown: {
    validate: {
      validateReferences: "warning",
      validateFragmentLinks: "warning",
      validateFileLinks: "warning",
      validateMarkdownFileLinkFragments: "warning",
      validateUnusedLinkDefinitions: "hint",
      validateDuplicateLinkDefinitions: "warning",
      ignoreLinks: [],
    },
  },
  typescript: languageConfiguration,
} as const satisfies Record<string, ConfigurationValue>;

export const getClientConfiguration = (
  section: string | undefined,
): ConfigurationValue | null => {
  if (!section) return null;
  const [language, ...path] = section.split(".");
  const root = configurations[language as keyof typeof configurations];
  return path.reduce<ConfigurationValue | undefined>(
    (value, key) =>
      typeof value === "object" && !Array.isArray(value) && key in value
        ? (value as { readonly [key: string]: ConfigurationValue })[key]
        : undefined,
    root,
  ) ?? null;
};

/** Editor capabilities supported by the headless client. */
export const clientCapabilities = {
  workspace: {
    configuration: true,
    didChangeWatchedFiles: { dynamicRegistration: true },
    inlayHint: { refreshSupport: true },
    semanticTokens: { refreshSupport: true },
    symbol: {
      symbolKind: { valueSet: symbolKinds },
      tagSupport: { valueSet: symbolTags },
    },
  },
  textDocument: {
    callHierarchy: {},
    codeAction: {
      disabledSupport: true,
      dataSupport: true,
      isPreferredSupport: true,
      resolveSupport: { properties: ["edit", "command"] },
    },
    completion: {
      completionItemKind: { valueSet: completionItemKinds },
      completionItem: {
        snippetSupport: true,
        commitCharactersSupport: true,
        documentationFormat: markdown,
        deprecatedSupport: true,
        preselectSupport: true,
        tagSupport: { valueSet: [1] },
        insertReplaceSupport: true,
        resolveSupport: {
          properties: [
            "documentation",
            "detail",
            "additionalTextEdits",
            "command",
          ],
        },
        insertTextModeSupport: { valueSet: [1, 2] },
        labelDetailsSupport: true,
      },
      completionList: {
        itemDefaults: ["editRange"],
      },
    },
    definition: { linkSupport: true },
    diagnostic: { relatedDocumentSupport: true },
    documentHighlight: {},
    documentLink: { tooltipSupport: true },
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: { valueSet: symbolKinds },
      tagSupport: { valueSet: symbolTags },
    },
    foldingRange: {
      foldingRangeKind: {
        valueSet: ["comment", "imports", "region"],
      },
      foldingRange: { collapsedText: true },
    },
    hover: { contentFormat: markdown },
    implementation: { linkSupport: true },
    inlayHint: {},
    publishDiagnostics: {
      relatedInformation: true,
      tagSupport: { valueSet: [1, 2] },
      versionSupport: true,
      codeDescriptionSupport: true,
      dataSupport: true,
    },
    references: {},
    rename: {
      prepareSupport: true,
      prepareSupportDefaultBehavior: 1,
    },
    selectionRange: {},
    semanticTokens: {
      requests: { range: true, full: true },
      tokenTypes: [
        "namespace",
        "type",
        "class",
        "enum",
        "interface",
        "struct",
        "typeParameter",
        "parameter",
        "variable",
        "property",
        "enumMember",
        "event",
        "function",
        "method",
        "macro",
        "label",
        "comment",
        "string",
        "number",
        "regexp",
        "operator",
        "decorator",
      ],
      tokenModifiers: [
        "declaration",
        "definition",
        "readonly",
        "static",
        "deprecated",
        "abstract",
        "async",
        "modification",
        "documentation",
        "defaultLibrary",
      ],
      formats: ["relative"],
      overlappingTokenSupport: true,
      multilineTokenSupport: true,
    },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: markdown,
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
      },
      contextSupport: true,
    },
    typeDefinition: { linkSupport: true },
  },
  general: {
    positionEncodings: ["utf-16"],
  },
} satisfies ClientCapabilities;
