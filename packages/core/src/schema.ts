import type { FeatureDocumentSchema } from "./types";

export const defaultFeatureDocumentSchema: FeatureDocumentSchema = {
  blocks: {
    title: {
      name: "title",
      description: "Short human-facing name for the feature.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<title>Feature Name</title>",
    },
    intent: {
      name: "intent",
      description: "Explain what problem this feature solves, what it owns, and what callers provide.",
      kind: "text",
      cardinality: "single",
      required: true,
      insertTemplate:
        "<intent>\n  Describe what this feature is for.\n  Owns: ...\n  Caller provides: ...\n</intent>",
    },
    anatomy: {
      name: "anatomy",
      description: "Describe the structural parts of the feature and how they compose.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<anatomy>\n  FeatureRoot\n    > ChildPart\n</anatomy>",
    },
    guidance: {
      name: "guidance",
      description: "Optional author guidance for preferred usage and implementation posture.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<guidance>\n  Preferred usage guidance.\n</guidance>",
    },
    "anti-patterns": {
      name: "anti-patterns",
      description: "Optional misuse guidance for humans and agents.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<anti-patterns>\n  - Avoid ...\n</anti-patterns>",
    },
    constraints: {
      name: "constraints",
      description: "Hard constraints and negative guidance that implementations should respect.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<constraints>\n  - Do NOT ...\n</constraints>",
    },
    related: {
      name: "related",
      description: "Related features, primitives, or wrappers that should be considered alongside this feature.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<related>\n  related-feature    - when to use it\n</related>",
    },
    tokens: {
      name: "tokens",
      description: "Tokens or CSS custom properties that shape the feature surface.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<tokens>\n  --token-name: value\n</tokens>",
    },
    decisions: {
      name: "decisions",
      description: "Decision log entries that explain why the feature works the way it does.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<decisions>\n  2026-03-28: explain the decision.\n</decisions>",
    },
    checklist: {
      name: "checklist",
      description: "Review checklist items for quality, accessibility, and rollout confidence.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<checklist>\n  [ ] Validate accessibility\n</checklist>",
    },
    status: {
      name: "status",
      description: "Current phase, review date, and open questions for the feature.",
      kind: "text",
      cardinality: "single",
      insertTemplate:
        "<status phase=\"draft\" reviewed=\"2026-03-28\">\n  open: add an open question or current state.\n</status>",
    },
    notes: {
      name: "notes",
      description: "Optional implementation or adoption notes.",
      kind: "text",
      cardinality: "single",
      insertTemplate: "<notes>\n  Additional notes.\n</notes>",
    },
    setup: {
      name: "setup",
      description: "Shared TS or TSX prelude that is injected into every embedded code block.",
      kind: "code",
      cardinality: "single",
      embeddedLanguage: "ts",
      codeShape: "module",
      emitServiceScript: false,
      insertTemplate:
        "<setup lang=\"ts\">\nimport { useState } from \"react\"\nimport { ExampleComponent } from \"./components\"\n</setup>",
    },
    recipe: {
      name: "recipe",
      description: "Canonical authored implementation recipe. These blocks are typechecked through Volar.",
      kind: "code",
      cardinality: "multiple",
      requiredAttributes: ["id", "intent"],
      embeddedLanguage: "tsx",
      codeShape: "module",
      emitServiceScript: true,
      insertTemplate:
        "<recipe id=\"new-recipe\" intent=\"describe the scenario\">\n  function NewRecipe() {\n    return <ExampleComponent />\n  }\n</recipe>",
    },
    showcase: {
      name: "showcase",
      description: "Richer visual or interactive showcase code. These blocks are typechecked through Volar.",
      kind: "code",
      cardinality: "multiple",
      requiredAttributes: ["id", "title"],
      embeddedLanguage: "tsx",
      codeShape: "module",
      emitServiceScript: true,
      insertTemplate:
        "<showcase id=\"new-showcase\" title=\"Visual scenario\">\n  function NewShowcase() {\n    return <ExampleComponent />\n  }\n</showcase>",
    },
    examples: {
      name: "examples",
      description: "Legacy container for nested <example> blocks.",
      kind: "container",
      cardinality: "single",
      insertTemplate:
        "<examples>\n  <example id=\"new-example\">\n    <ExampleComponent />\n  </example>\n</examples>",
      children: {
        example: {
          name: "example",
          description: "Legacy embedded TSX example. Diagnostics map back into this block.",
          kind: "code",
          cardinality: "multiple",
          required: true,
          requiredAttributes: ["id"],
          embeddedLanguage: "tsx",
          codeShape: "fragment",
          emitServiceScript: true,
          insertTemplate:
            "<example id=\"new-example\">\n  <ExampleComponent />\n</example>",
        },
      },
    },
  },
};

export function getFeatureBlockDefinition(
  name: string,
  schema: FeatureDocumentSchema = defaultFeatureDocumentSchema,
) {
  return schema.blocks[name];
}

export function extendFeatureDocumentSchema(
  extension: Partial<FeatureDocumentSchema>,
  baseSchema: FeatureDocumentSchema = defaultFeatureDocumentSchema,
): FeatureDocumentSchema {
  return {
    blocks: mergeBlockDefinitions(baseSchema.blocks, extension.blocks ?? {}),
  };
}

function mergeBlockDefinitions(
  baseDefinitions: FeatureDocumentSchema["blocks"],
  extensionDefinitions: FeatureDocumentSchema["blocks"],
): FeatureDocumentSchema["blocks"] {
  const merged: FeatureDocumentSchema["blocks"] = {
    ...baseDefinitions,
  };

  for (const [name, definition] of Object.entries(extensionDefinitions)) {
    const baseDefinition = baseDefinitions[name];

    merged[name] =
      baseDefinition
        ? {
            ...baseDefinition,
            ...definition,
            children: mergeBlockDefinitions(
              baseDefinition.children ?? {},
              definition.children ?? {},
            ),
          }
        : {
            ...definition,
            children: mergeBlockDefinitions({}, definition.children ?? {}),
          };
  }

  return merged;
}
