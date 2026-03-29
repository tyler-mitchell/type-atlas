import {
  defaultFeatureDocumentSchema,
  type FeatureBlock,
  type FeatureBlockDefinition,
  type FeatureDocument,
  type FeatureParseError,
  type FeatureDocumentSchema,
} from "@featuretype/core";
import type { LanguageServicePlugin, TextEdit } from "@volar/language-service";
import {
  CodeActionKind,
  DiagnosticSeverity,
  MarkupKind,
  SymbolKind,
  type DocumentSymbol,
} from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import { FeatureTypeVirtualCode } from "./languagePlugin";

export function createFeatureTypeServicePlugin(options: {
  schema?: FeatureDocumentSchema;
} = {}): LanguageServicePlugin {
  const schema = options.schema ?? defaultFeatureDocumentSchema;

  return {
    name: "featuretype",
    capabilities: {
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
      documentSymbolProvider: true,
      hoverProvider: true,
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite],
      },
    },
    create(context) {
      return {
        provideDiagnostics(document) {
          const root = getFeatureTypeRoot(context, document.uri);
          if (!root) {
            return;
          }

          return root.document.errors.map((error) => toDiagnostic(document, error));
        },

        provideDocumentSymbols(document) {
          const root = getFeatureTypeRoot(context, document.uri);
          if (!root) {
            return;
          }

          return root.document.blocks.map((block) => toDocumentSymbol(document, block));
        },

        provideHover(document, position) {
          const root = getFeatureTypeRoot(context, document.uri);
          if (!root) {
            return;
          }

          const offset = document.offsetAt(position);
          const hovered = findHoveredTag(root.document, offset);
          if (!hovered) {
            return;
          }

          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `**<${hovered.tag}>**\n\n${hovered.description}`,
            },
            range: toRange(document, hovered.range),
          };
        },

        provideCodeActions(document) {
          const root = getFeatureTypeRoot(context, document.uri);
          if (!root) {
            return;
          }

          const actions = [];
          for (const definition of Object.values(schema.blocks)) {
            if (!definition.required || definition.cardinality !== "single") {
              continue;
            }

            if ((root.document.blocksByName[definition.name] ?? []).length > 0) {
              continue;
            }

            if (!definition.insertTemplate) {
              continue;
            }

            actions.push({
              title: `Add <${definition.name}> block`,
              kind: CodeActionKind.QuickFix,
              edit: {
                changes: {
                  [document.uri]: [
                    {
                      newText: `${definition.insertTemplate}\n\n`,
                      range: toEmptyRange(document, 0),
                    },
                  ],
                },
              },
            });
          }

          for (const definition of Object.values(schema.blocks)) {
            if (!shouldOfferTopLevelInsertion(definition)) {
              continue;
            }

            const existingBlocks = root.document.blocksByName[definition.name] ?? [];
            if (definition.cardinality === "single" && existingBlocks.length > 0) {
              continue;
            }

            actions.push(createTopLevelInsertionAction(document, definition));
          }

          for (const block of root.document.allBlocks) {
            if (!block.definition?.children) {
              continue;
            }

            for (const childDefinition of Object.values(block.definition.children)) {
              if (!childDefinition.insertTemplate) {
                continue;
              }

              const existingChildren = block.children.filter(
                (childBlock) => childBlock.name === childDefinition.name,
              );
              if (childDefinition.cardinality === "single" && existingChildren.length > 0) {
                continue;
              }

              actions.push(createNestedInsertionAction(document, block, childDefinition));
            }
          }

          return actions;
        },
      };
    },
  };
}

function getFeatureTypeRoot(
  context: Parameters<LanguageServicePlugin["create"]>[0],
  uri: string,
): FeatureTypeVirtualCode | undefined {
  const parsedUri = URI.parse(uri);
  const decoded = context.decodeEmbeddedDocumentUri(parsedUri);

  if (decoded) {
    if (decoded[1] !== "root") {
      return undefined;
    }

    const sourceScript = context.language.scripts.get(decoded[0]);
    const root = sourceScript?.generated?.root;
    if (root instanceof FeatureTypeVirtualCode) {
      return root;
    }
  }

  const sourceScript = context.language.scripts.get(parsedUri);
  const root = sourceScript?.generated?.root;
  if (root instanceof FeatureTypeVirtualCode) {
    return root as FeatureTypeVirtualCode;
  }
}

function findHoveredTag(
  document: FeatureDocument,
  offset: number,
): { tag: string; description: string; range: { start: number; end: number } } | undefined {
  for (const block of document.allBlocks) {
    if (offset >= block.range.openTagStart && offset <= block.range.openTagEnd) {
      return {
        tag: block.name,
        description:
          block.definition?.description ??
          "FeatureType authored block.",
        range: {
          start: block.range.openTagStart,
          end: block.range.openTagEnd,
        },
      };
    }
  }
}

function createBlockSymbolName(block: FeatureBlock) {
  if (block.definition?.kind === "code") {
    const id = getStringAttribute(block.attributes.id);
    const title =
      getStringAttribute(block.attributes.title) ??
      getStringAttribute(block.attributes.intent);
    return title ?? id ?? block.name;
  }

  return block.name;
}

function createBlockSymbolDetail(block: FeatureBlock) {
  const id = getStringAttribute(block.attributes.id);
  return id ? `${block.name}:${id}` : block.name;
}

function toSymbolKind(block: FeatureBlock) {
  if (block.definition?.kind === "container") {
    return SymbolKind.Namespace;
  }

  if (block.definition?.kind === "code") {
    return SymbolKind.Function;
  }

  return SymbolKind.String;
}

function toDocumentSymbol(
  document: {
    positionAt(offset: number): { line: number; character: number };
  },
  block: FeatureBlock,
): DocumentSymbol {
  return {
    name: createBlockSymbolName(block),
    detail: createBlockSymbolDetail(block),
    kind: toSymbolKind(block),
    range: toRange(document, {
      start: block.range.openTagStart,
      end: block.range.closeTagEnd,
    }),
    selectionRange: toRange(document, {
      start: block.range.openTagStart + 1,
      end: block.range.openTagEnd - 1,
    }),
    children: block.children.map((childBlock) => toDocumentSymbol(document, childBlock)),
  };
}

function toDiagnostic(
  document: {
    positionAt(offset: number): { line: number; character: number };
  },
  error: FeatureParseError,
) {
  const range = error.range ?? { start: 0, end: 0 };
  return {
    code: error.code,
    message: error.message,
    range: toRange(document, range),
    severity:
      error.severity === "warning"
        ? DiagnosticSeverity.Warning
        : DiagnosticSeverity.Error,
    source: "featuretype",
  };
}

function toRange(
  document: { positionAt(offset: number): { line: number; character: number } },
  range: { start: number; end: number },
) {
  return {
    start: document.positionAt(range.start),
    end: document.positionAt(range.end),
  };
}

function toEmptyRange(
  document: { positionAt(offset: number): { line: number; character: number } },
  offset: number,
): TextEdit["range"] {
  return {
    start: document.positionAt(offset),
    end: document.positionAt(offset),
  };
}

function shouldOfferTopLevelInsertion(definition: FeatureBlockDefinition) {
  if (!definition.insertTemplate) {
    return false;
  }

  if (definition.required && definition.cardinality === "single") {
    return false;
  }

  return definition.required || definition.kind !== "text";
}

function createTopLevelInsertionAction(
  document: {
    getText(): string;
    positionAt(offset: number): { line: number; character: number };
    uri: string;
  },
  definition: FeatureBlockDefinition,
) {
  return {
    title:
      definition.cardinality === "single"
        ? `Add <${definition.name}> block`
        : `Insert <${definition.name}> block`,
    kind: CodeActionKind.RefactorRewrite,
    edit: {
      changes: {
        [document.uri]: [
          {
            newText: `\n${definition.insertTemplate}\n`,
            range: toEmptyRange(document, document.getText().length),
          },
        ],
      },
    },
  };
}

function createNestedInsertionAction(
  document: {
    positionAt(offset: number): { line: number; character: number };
    uri: string;
  },
  containerBlock: FeatureBlock,
  childDefinition: FeatureBlockDefinition,
) {
  return {
    title: `Insert <${childDefinition.name}> into <${containerBlock.name}>`,
    kind: CodeActionKind.RefactorRewrite,
    edit: {
      changes: {
        [document.uri]: [
          {
            newText: `\n${indentBlockTemplate(childDefinition.insertTemplate ?? "", "  ")}\n`,
            range: toEmptyRange(document, containerBlock.range.contentEnd),
          },
        ],
      },
    },
  };
}

function indentBlockTemplate(template: string, indent: string) {
  return template
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function getStringAttribute(value: string | true | undefined) {
  return typeof value === "string" ? value : undefined;
}
