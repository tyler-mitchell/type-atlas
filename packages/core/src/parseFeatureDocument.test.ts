import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFeatureDocument } from "./parseFeatureDocument";

describe("parseFeatureDocument", () => {
  it("extracts TypeScript fences with authored offsets and file metadata", () => {
    const source = [
      "# Usage Notes",
      "",
      "Prose before the code fence.",
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
      "export const View = () => <div />",
      "```",
      "",
    ].join("\n");

    const document = parseFeatureDocument({
      filePath: "/repo/docs/example.featuretype",
      source,
      fileExists: () => false,
    });

    expect(document.displayName).toBe("Usage Notes");
    expect(document.codeBlocks).toHaveLength(2);
    expect(document.errors).toEqual([]);

    expect(document.codeBlocks[0]).toMatchObject({
      language: "ts",
      file: "./root.ts",
      fileName: path.resolve("/repo/docs/root.ts"),
      importable: true,
    });
    expect(document.codeBlocks[0]?.code).toBe(
      "// root.ts\nimport { helper } from \"./helper\"\n\nexport const root = helper(\"ok\")\n",
    );
    expect(document.codeBlocks[0]?.range.contentStart).toBe(
      source.indexOf("// root.ts"),
    );
    expect(document.codeBlocks[0]?.range.contentEnd).toBe(
      source.indexOf("```", source.indexOf("export const root")),
    );

    expect(document.codeBlocks[1]).toMatchObject({
      language: "tsx",
      file: "./view.tsx",
      fileName: path.resolve("/repo/docs/view.tsx"),
      importable: true,
    });
  });

  it("ignores prose and non-TypeScript fences", () => {
    const document = parseFeatureDocument({
      filePath: "/repo/docs/example.featuretype",
      source: [
        "# Example",
        "",
        "```json",
        "{\"ok\": true}",
        "```",
        "",
        "```ts",
        "export const anonymous = true",
        "```",
      ].join("\n"),
      fileExists: () => false,
    });

    expect(document.codeBlocks).toHaveLength(1);
    expect(document.codeBlocks[0]).toMatchObject({
      language: "ts",
      file: undefined,
      fileName: undefined,
      importable: false,
    });
    expect(document.errors).toEqual([]);
  });

  it("ignores ordinary first-line comments that do not contain a TypeScript path", () => {
    const document = parseFeatureDocument({
      filePath: "/repo/docs/example.featuretype",
      source: [
        "# Research Notes",
        "",
        "```ts",
        "// Source: https://github.com/vuejs/language-tools",
        "export const source = true",
        "```",
      ].join("\n"),
      fileExists: () => false,
    });

    expect(document.codeBlocks).toHaveLength(1);
    expect(document.codeBlocks[0]).toMatchObject({
      file: undefined,
      fileName: undefined,
      importable: false,
    });
    expect(document.errors).toEqual([]);
  });

  it("reports invalid importable fence file paths", () => {
    const document = parseFeatureDocument({
      filePath: "/repo/docs/example.featuretype",
      source: [
        "```ts",
        "// ../outside.ts",
        "export const outside = true",
        "```",
        "",
        "```tsx",
        "// ./view.ts",
        "export const View = () => <div />",
        "```",
        "",
        "```ts",
        "// ./missing-extension",
        "export const missing = true",
        "```",
      ].join("\n"),
      fileExists: () => false,
    });

    expect(document.codeBlocks).toHaveLength(3);
    expect(document.codeBlocks.every((block) => !block.importable)).toBe(true);
    expect(document.errors.map((error) => error.code)).toEqual([
      "invalid-fence-file",
      "fence-extension-mismatch",
    ]);
  });

  it("reports duplicate virtual module names on every colliding fence", () => {
    const document = parseFeatureDocument({
      filePath: "/repo/docs/example.featuretype",
      source: [
        "```ts",
        "// ./dup.ts",
        "export const first = true",
        "```",
        "",
        "```ts",
        "// ./dup.ts",
        "export const second = true",
        "```",
      ].join("\n"),
      fileExists: () => false,
    });

    expect(document.codeBlocks.map((block) => block.importable)).toEqual([
      false,
      false,
    ]);
    expect(document.errors.map((error) => error.code)).toEqual([
      "duplicate-fence-file",
      "duplicate-fence-file",
    ]);
  });

  it("reports real-file shadowing", () => {
    const shadowedPath = path.resolve("/repo/docs/helper.ts");
    const document = parseFeatureDocument({
      filePath: "/repo/docs/example.featuretype",
      source: [
        "```ts",
        "// ./helper.ts",
        "export const helper = true",
        "```",
      ].join("\n"),
      fileExists: (filePath) => filePath === shadowedPath,
    });

    expect(document.codeBlocks[0]?.importable).toBe(false);
    expect(document.errors.map((error) => error.code)).toEqual([
      "fence-file-shadows-real-file",
    ]);
  });

  it("preserves offsets across multibyte text, CRLF, empty fences, and unclosed fences", () => {
    const source = [
      "# Café",
      "",
      "```ts",
      "// ./empty.ts",
      "```",
      "",
      "```ts",
      "// ./open.ts",
      "export const open = \"é\"",
    ].join("\r\n");

    const document = parseFeatureDocument({
      filePath: "/repo/docs/example.featuretype",
      source,
      fileExists: () => false,
    });

    expect(document.codeBlocks).toHaveLength(2);
    expect(document.codeBlocks[0]?.code).toBe("// ./empty.ts\r\n");
    expect(document.codeBlocks[0]?.range.contentEnd).toBe(
      source.indexOf("```", source.indexOf("// ./empty.ts")),
    );
    expect(document.codeBlocks[1]?.code).toBe("// ./open.ts\r\nexport const open = \"é\"");
    expect(document.codeBlocks[1]?.range.closingFenceStart).toBeUndefined();
  });
});
