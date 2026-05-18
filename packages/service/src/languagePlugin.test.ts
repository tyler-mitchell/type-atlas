import path from "node:path";
import { printSnapshot } from "@volar/test-utils";
import { describe, expect, it } from "vitest";
import { URI } from "vscode-uri";
import {
  createFeatureTypeLanguagePlugin,
  FeatureTypeVirtualCode,
} from "./languagePlugin";

describe("FeatureTypeVirtualCode", () => {
  it("registers raw fenced TypeScript modules as Volar extra service scripts", () => {
    const sourceFileName = "/workspace/docs/example.featuretype";
    const root = createRoot(sourceFileName, [
      "# Example",
      "",
      "```ts",
      "// root.ts",
      "import { helper } from \"./helper\"",
      "",
      "export const root = helper(\"ok\")",
      "```",
      "",
      "```tsx",
      "// ./view.tsx",
      "export const View = () => <main />",
      "```",
    ].join("\n"));
    const plugin = createFeatureTypeLanguagePlugin();

    const scripts = plugin.typescript?.getExtraServiceScripts?.(
      sourceFileName,
      root,
    ) ?? [];

    expect(scripts.map((script) => ({
      fileName: script.fileName,
      extension: script.extension,
      scriptKind: script.scriptKind,
      languageId: script.code.languageId,
      text: script.code.snapshot.getText(0, script.code.snapshot.getLength()),
    }))).toEqual([
      {
        fileName: path.resolve("/workspace/docs/root.ts"),
        extension: ".ts",
        scriptKind: 3,
        languageId: "typescript",
        text: "// root.ts\nimport { helper } from \"./helper\"\n\nexport const root = helper(\"ok\")\n",
      },
      {
        fileName: path.resolve("/workspace/docs/view.tsx"),
        extension: ".tsx",
        scriptKind: 4,
        languageId: "typescriptreact",
        text: "// ./view.tsx\nexport const View = () => <main />\n",
      },
    ]);
  });

  it("prints one-to-one Volar source-map evidence for fenced code", () => {
    const source = [
      "# Café",
      "",
      "Prose before the TypeScript fence.",
      "",
      "```ts",
      "// root.ts",
      "import { helper } from \"./helper\"",
      "",
      "export const root = helper(\"ok\")",
      "```",
    ].join("\n");
    const root = createRoot("/workspace/docs/example.featuretype", source);
    const rootCode = root.embeddedCodes[0];

    if (!rootCode) {
      throw new Error("Expected a TypeScript virtual code block.");
    }

    const snapshot = [...printSnapshot({ snapshot: root.snapshot }, rootCode)]
      .join("\n");

    expect(snapshot).toContain("[1] //·root.ts");
    expect(snapshot).toContain("[6] (exact match) (:6:1)");
    expect(snapshot).toContain("[2] import·{·helper·}·from·\"./helper\"");
    expect(snapshot).toContain("[7] (exact match) (:7:1)");
    expect(snapshot).toContain("[4] export·const·root·=·helper(\"ok\")");
    expect(snapshot).toContain("[9] export·const·root·=·helper(\"ok\")↵ (:9:1)");
  });
});

function createRoot(fileName: string, source: string) {
  return new FeatureTypeVirtualCode(
    URI.file(fileName),
    createSnapshot(source),
  );
}

function createSnapshot(text: string) {
  return {
    getText(start: number, end: number) {
      return text.slice(start, end);
    },
    getLength() {
      return text.length;
    },
    getChangeRange() {
      return undefined;
    },
  };
}
