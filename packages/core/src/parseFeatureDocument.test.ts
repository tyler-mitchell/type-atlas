import { describe, expect, it } from "vitest";
import { extendFeatureDocumentSchema } from "./schema";
import { parseFeatureDocument } from "./parseFeatureDocument";

describe("parseFeatureDocument", () => {
  it("extracts legacy nested examples as embedded code blocks", () => {
    const document = parseFeatureDocument({
      filePath: "/tmp/button.featuretype",
      source: `
<title>Button</title>

<intent>
  Trigger a primary or secondary action.
</intent>

<setup lang="ts">
import { Button } from "./components"
</setup>

<examples>
  <example id="default" title="Primary action">
    <Button tone="primary">Save</Button>
  </example>
</examples>
`,
    });

    expect(document.displayName).toBe("Button");
    expect(document.intent?.content).toContain("Trigger a primary");
    expect(document.setup?.attributes.lang).toBe("ts");
    expect(document.blocks.map((block) => block.name)).toEqual([
      "title",
      "intent",
      "setup",
      "examples",
    ]);
    expect(document.examples).toHaveLength(1);
    expect(document.codeBlocks).toHaveLength(1);
    expect(document.codeBlocks[0]?.id).toBe("default");
    expect(document.codeBlocks[0]?.codeShape).toBe("fragment");
    expect(document.codeBlocks[0]?.code).toContain("<Button tone=");
    expect(document.errors).toEqual([]);
  });

  it("extracts top-level recipes and showcases for agent-expandable authored features", () => {
    const document = parseFeatureDocument({
      filePath: "/tmp/single-select-combobox.featuretype",
      source: `
<intent>
  Single-select combobox for toolbar filter controls.
</intent>

<recipe id="minimal-controlled" intent="controlled single-select with local state">
  function MinimalControlledCombobox() {
    return <SingleSelectCombobox />
  }
</recipe>

<showcase id="toolbar-composition" title="In-App Filter Toolbars" controls>
  function ToolbarShowcase({ size, variant }) {
    return <div>{size}{variant}</div>
  }
</showcase>

<status phase="active" reviewed="2026-03-28">
  open: should ComboboxInput be a separate export or built-in?
</status>
`,
    });

    expect(document.codeBlocks).toHaveLength(2);
    expect(document.codeBlocks.map((block) => block.name)).toEqual([
      "recipe",
      "showcase",
    ]);
    expect(document.codeBlocks[0]?.codeShape).toBe("module");
    expect(document.codeBlocks[1]?.attributes.controls).toBe(true);
    expect(document.blocksByName.status?.[0]?.attributes.reviewed).toBe("2026-03-28");
    expect(document.errors).toEqual([]);
  });

  it("supports schema extensions with nested agent-expandable blocks", () => {
    const schema = extendFeatureDocumentSchema({
      blocks: {
        capabilities: {
          name: "capabilities",
          description: "Agent capability declarations for this feature.",
          kind: "container",
          cardinality: "single",
          insertTemplate:
            "<capabilities>\n  <agent-capability id=\"new-capability\" name=\"describe capability\">\n    export const capability = true\n  </agent-capability>\n</capabilities>",
          children: {
            "agent-capability": {
              name: "agent-capability",
              description: "Executable or declarative agent capability block.",
              kind: "code",
              cardinality: "multiple",
              requiredAttributes: ["id", "name"],
              embeddedLanguage: "ts",
              codeShape: "module",
              emitServiceScript: true,
              insertTemplate:
                "<agent-capability id=\"new-capability\" name=\"describe capability\">\n  export const capability = true\n</agent-capability>",
            },
          },
        },
      },
    });

    const document = parseFeatureDocument({
      filePath: "/tmp/capabilities.featuretype",
      schema,
      source: `
<intent>
  A feature with agent-specific authoring hooks.
</intent>

<capabilities>
  <agent-capability id="hover" name="hover summary">
    export const hover = "Summarize the feature on hover"
  </agent-capability>
</capabilities>
`,
    });

    expect(document.blocksByName.capabilities?.[0]?.children.map((block) => block.name)).toEqual([
      "agent-capability",
    ]);
    expect(document.allBlocks.map((block) => block.name)).toEqual([
      "intent",
      "capabilities",
      "agent-capability",
    ]);
    expect(document.codeBlocks[0]?.parentBlockName).toBe("capabilities");
    expect(document.codeBlocks[0]?.language).toBe("ts");
    expect(document.errors).toEqual([]);
  });

  it("reports structural problems for required blocks and required attributes", () => {
    const document = parseFeatureDocument({
      filePath: "/tmp/broken.featuretype",
      source: `
<recipe>
  function BrokenRecipe() {
    return <Button />
  }
</recipe>
`,
    });

    expect(document.errors.map((error) => error.code)).toEqual([
      "missing-required-block",
      "missing-required-attribute",
      "missing-required-attribute",
    ]);
  });
});
