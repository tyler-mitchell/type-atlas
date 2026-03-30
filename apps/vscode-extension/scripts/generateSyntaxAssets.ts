import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface GrammarBlockDefinition {
  name: string;
  kind: "text" | "code" | "container";
  embeddedLanguage?: "ts" | "tsx";
  children?: Record<string, GrammarBlockDefinition>;
}

interface GrammarSchema {
  blocks: Record<string, GrammarBlockDefinition>;
}

interface GrammarBlockEntry {
  definition: GrammarBlockDefinition;
  parentName?: string;
}

export async function generateSyntaxAssets() {
  const schema = await loadDefaultSchema();
  const extensionRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const syntaxesDir = path.join(extensionRoot, "syntaxes");

  await mkdir(syntaxesDir, { recursive: true });
  await writeFile(
    path.join(syntaxesDir, "featuretype.tmLanguage.json"),
    `${JSON.stringify(createGrammar(schema), null, 2)}\n`,
    "utf8",
  );
}

async function loadDefaultSchema(): Promise<GrammarSchema> {
  const schemaModulePath = new URL(
    "../../../packages/core/src/schema.ts",
    import.meta.url,
  ).href;
  const schemaModule = await import(schemaModulePath) as {
    defaultFeatureDocumentSchema: GrammarSchema;
  };

  return schemaModule.defaultFeatureDocumentSchema;
}

function createGrammar(schema: GrammarSchema) {
  const topLevelEntries = Object.values(schema.blocks).map((definition) => ({
    definition,
  }));
  const allEntries = collectBlockEntries(schema.blocks);

  return {
    $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
    name: "FeatureType",
    scopeName: "source.featuretype",
    fileTypes: ["featuretype"],
    patterns: [
      { include: "#comments" },
      ...topLevelEntries.map((entry) => ({
        include: `#${createRuleName(entry)}`,
      })),
    ],
    repository: {
      comments: {
        name: "comment.block.featuretype",
        begin: "<!--",
        end: "-->",
        beginCaptures: {
          0: {
            name: "punctuation.definition.comment.begin.featuretype",
          },
        },
        endCaptures: {
          0: {
            name: "punctuation.definition.comment.end.featuretype",
          },
        },
      },
      tagAttributes: {
        patterns: [
          {
            match:
              "\\s+([A-Za-z][A-Za-z0-9-]*)(\\s*=\\s*)(\"[^\"]*\"|'[^']*')",
            captures: {
              1: {
                name: "entity.other.attribute-name.featuretype",
              },
              2: {
                name: "punctuation.separator.key-value.featuretype",
              },
              3: {
                name: "string.quoted.double.featuretype",
              },
            },
          },
          {
            match: "\\s+([A-Za-z][A-Za-z0-9-]*)",
            captures: {
              1: {
                name: "entity.other.attribute-name.featuretype",
              },
            },
          },
        ],
      },
      textContent: {
        patterns: [
          {
            match: "^\\s*(\\[[xX ]\\])",
            captures: {
              1: {
                name: "keyword.other.checkbox.featuretype",
              },
            },
          },
          {
            match: "^\\s*(-)(?=\\s)",
            captures: {
              1: {
                name: "punctuation.definition.list.begin.featuretype",
              },
            },
          },
          {
            match: "^\\s*(>)(?=\\s)",
            captures: {
              1: {
                name: "punctuation.separator.hierarchy.featuretype",
              },
            },
          },
          {
            match: "(--[A-Za-z0-9-]+)(\\s*:)",
            captures: {
              1: {
                name: "support.type.property-name.css",
              },
              2: {
                name: "punctuation.separator.key-value.featuretype",
              },
            },
          },
          {
            match: "^\\s*([A-Za-z][A-Za-z0-9-]*)(:)",
            captures: {
              1: {
                name: "entity.name.label.featuretype",
              },
              2: {
                name: "punctuation.separator.key-value.featuretype",
              },
            },
          },
        ],
      },
      ...Object.fromEntries(
        allEntries.map((entry) => [
          createRuleName(entry),
          createBlockRule(entry),
        ]),
      ),
    },
  };
}

function collectBlockEntries(
  definitions: Record<string, GrammarBlockDefinition>,
  parentName?: string,
): GrammarBlockEntry[] {
  return Object.values(definitions).flatMap((definition) => [
    {
      definition,
      parentName,
    },
    ...collectBlockEntries(definition.children ?? {}, definition.name),
  ]);
}

function createBlockRule(entry: GrammarBlockEntry) {
  const tagName = escapeRegex(entry.definition.name);
  const childIncludes = Object.values(entry.definition.children ?? {}).map((childDefinition) => ({
    include: `#${createRuleName({
      definition: childDefinition,
      parentName: entry.definition.name,
    })}`,
  }));

  return {
    name: createBlockScope(entry),
    begin: `(<)(${tagName})(?=\\s|>)`,
    beginCaptures: {
      1: {
        name: "punctuation.definition.tag.begin.featuretype",
      },
      2: {
        name: createTagScope(entry),
      },
    },
    end: `(</)(${tagName})(>)`,
    endCaptures: {
      1: {
        name: "punctuation.definition.tag.begin.featuretype",
      },
      2: {
        name: createTagScope(entry),
      },
      3: {
        name: "punctuation.definition.tag.end.featuretype",
      },
    },
    patterns: [
      {
        begin: "\\G",
        end: "(>)",
        endCaptures: {
          1: {
            name: "punctuation.definition.tag.end.featuretype",
          },
        },
        contentName: "meta.tag.featuretype",
        patterns: [{ include: "#tagAttributes" }],
      },
      createContentRule(entry, childIncludes),
    ],
  };
}

function createContentRule(
  entry: GrammarBlockEntry,
  childIncludes: Array<{ include: string }>,
) {
  const tagName = escapeRegex(entry.definition.name);

  if (entry.definition.kind === "code") {
    const embeddedScope = getEmbeddedScope(entry);

    return {
      begin: "(?<=>)",
      end: `(?=</${tagName}>)`,
      name: `meta.embedded.block.featuretype.${toScopeSegment(entry.definition.name)}`,
      contentName: embeddedScope,
      patterns: [{ include: embeddedScope }],
    };
  }

  return {
    begin: "(?<=>)",
    end: `(?=</${tagName}>)`,
    contentName:
      entry.definition.kind === "container"
        ? `meta.block.container.featuretype.${toScopeSegment(entry.definition.name)}`
        : `meta.block.featuretype.${toScopeSegment(entry.definition.name)}`,
    patterns: [
      { include: "#comments" },
      ...childIncludes,
      { include: "#textContent" },
    ],
  };
}

function getEmbeddedScope(entry: GrammarBlockEntry) {
  if (entry.definition.name === "setup") {
    return "source.tsx";
  }

  return entry.definition.embeddedLanguage === "ts" ? "source.ts" : "source.tsx";
}

function createRuleName(entry: GrammarBlockEntry) {
  return ["block", entry.parentName, entry.definition.name]
    .filter((segment): segment is string => Boolean(segment))
    .map((segment) => segment.replace(/[^A-Za-z0-9]+/g, "_"))
    .join("__");
}

function createBlockScope(entry: GrammarBlockEntry) {
  return [
    "meta.block.featuretype",
    entry.parentName ? `meta.block.parent.${toScopeSegment(entry.parentName)}` : undefined,
    `meta.block.kind.${entry.definition.kind}`,
    `meta.block.name.${toScopeSegment(entry.definition.name)}`,
  ]
    .filter((segment): segment is string => Boolean(segment))
    .join(" ");
}

function createTagScope(entry: GrammarBlockEntry) {
  return [
    "entity.name.tag.featuretype",
    `entity.name.tag.${toScopeSegment(entry.definition.kind)}.featuretype`,
  ].join(" ");
}

function toScopeSegment(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
