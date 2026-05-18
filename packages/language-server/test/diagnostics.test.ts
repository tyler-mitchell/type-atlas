import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageServerHandle } from "@volar/test-utils";
import type {
  DocumentSymbol,
  Location,
  LocationLink,
  SymbolInformation,
} from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import { createServer, fixturePath, fixtureUri, tsdk } from "./utils";

let serverHandle: LanguageServerHandle;

beforeEach(async () => {
  serverHandle = createServer();
  await serverHandle.initialize(fixtureUri(""), {
    typescript: { tsdk },
  });
});

afterEach(() => {
  serverHandle.connection.dispose();
});

describe("featuretype language server", () => {
  it("maps embedded ts diagnostics back onto fenced code in the source document", async () => {
    const { uri } = await serverHandle.openTextDocument(
      fixturePath("broken-button.featuretype"),
      "featuretype",
    );
    const diagnostics = await serverHandle.sendDocumentDiagnosticRequest(uri);
    if (diagnostics.kind !== "full") {
      throw new Error("Expected a full diagnostic report.");
    }

    const items = diagnostics.items;

    expect(items.map((item) => item.source)).toContain("ts");
    expect(items.some((item) => item.message.includes("Type '\"destructive\"'"))).toBe(true);
    expect(items.every((item) => item.range.start.line >= 0)).toBe(true);
  });

  it("reports structural diagnostics for invalid Markdown fence module declarations", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "featuretype-lsp-"));
    await writeFile(path.join(tempDir, "shadow.ts"), "export const real = true\n");

    const document = await serverHandle.openInMemoryDocument(
      URI.file(path.join(tempDir, "invalid-fence.featuretype")).toString(),
      "featuretype",
      [
        "# Invalid Fence",
        "",
        "```ts",
        "// ../outside.ts",
        "export const outside = true",
        "```",
        "",
        "```ts",
        "// /absolute.ts",
        "export const absolute = true",
        "```",
        "",
        "```ts",
        "// https://example.com/module.ts",
        "export const url = true",
        "```",
        "",
        "```ts",
        "// ./missing-extension",
        "export const missing = true",
        "```",
        "",
        "```tsx",
        "// ./view.ts",
        "export const View = () => <div />",
        "```",
        "",
        "```ts",
        "// ./dup.ts",
        "export const first = true",
        "```",
        "",
        "```ts",
        "// ./dup.ts",
        "export const second = true",
        "```",
        "",
        "```ts",
        "// ./shadow.ts",
        "export const shadow = true",
        "```",
      ].join("\n"),
    );
    try {
      const diagnostics = await serverHandle.sendDocumentDiagnosticRequest(document.uri);
      if (diagnostics.kind !== "full") {
        throw new Error("Expected a full diagnostic report.");
      }

      expect(diagnostics.items.map((item) => item.source)).toEqual(
        Array.from({ length: 7 }, () => "featuretype"),
      );
      expect([...diagnostics.items.map((item) => item.code)].sort()).toEqual([
        "duplicate-fence-file",
        "duplicate-fence-file",
        "fence-extension-mismatch",
        "fence-file-shadows-real-file",
        "invalid-fence-file",
        "invalid-fence-file",
        "invalid-fence-file",
      ].sort());
      expect(diagnostics.items.every((item) =>
        item.range.start.line === item.range.end.line &&
        item.range.start.character < item.range.end.character
      )).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("maps hover, definition, and references through same-file fence imports", async () => {
    const document = await serverHandle.openTextDocument(
      fixturePath("same-file-import.featuretype"),
      "featuretype",
    );
    const source = document.getText();
    const helperCall = source.indexOf("helper(\"ok\")");
    const helperDefinition = source.indexOf("helper(value: string)");
    const position = document.positionAt(helperCall + 1);

    const hover = await serverHandle.sendHoverRequest(document.uri, position);
    const definitions = normalizeLocations(
      await serverHandle.sendDefinitionRequest(document.uri, position),
    );
    const references = await serverHandle.sendReferencesRequest(
      document.uri,
      position,
      { includeDeclaration: true },
    );

    expect(formatHover(hover)).toContain("helper");
    expect(definitions.some((location) =>
      getLocationUri(location) === document.uri &&
      getLocationStart(location).line === document.positionAt(helperDefinition).line
    )).toBe(true);
    expect(definitions.every((location) => getLocationUri(location) === document.uri))
      .toBe(true);
    expect(JSON.stringify(definitions)).not.toContain("helper.ts");
    expect((references ?? []).filter((location) => location.uri === document.uri).length)
      .toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(references ?? [])).not.toContain("helper.ts");
  });

  it("exposes fenced modules and TypeScript children through document symbols", async () => {
    const document = await serverHandle.openTextDocument(
      fixturePath("same-file-import.featuretype"),
      "featuretype",
    );

    const symbols = await serverHandle.sendDocumentSymbolRequest(document.uri);
    const documentSymbols = (symbols ?? []).filter(isDocumentSymbol);
    const rootModule = documentSymbols.find((symbol) => symbol.name === "./root.ts");
    const helperModule = documentSymbols.find((symbol) => symbol.name === "./helper.ts");

    expect(rootModule?.detail).toBe("ts");
    expect(rootModule?.children?.some((symbol) => symbol.name === "root")).toBe(true);
    expect(helperModule?.detail).toBe("ts");
    expect(helperModule?.children?.some((symbol) => symbol.name === "helper")).toBe(true);
  });

  it("refreshes same-file import resolution after only the fence file name changes", async () => {
    const document = await serverHandle.openInMemoryDocument(
      fixtureUri("refreshable.featuretype"),
      "featuretype",
      [
        "# Refreshable",
        "",
        "```ts",
        "// ./root.ts",
        "import { helper } from \"./helper\"",
        "",
        "export const root = helper(\"ok\")",
        "```",
        "",
        "```ts",
        "// ./not-helper.ts",
        "export function helper(value: string) {",
        "  return value.toUpperCase()",
        "}",
        "```",
      ].join("\n"),
    );

    const firstPosition = document.positionAt(document.getText().indexOf("helper(\"ok\")") + 1);
    const firstDefinitions = normalizeLocations(
      await serverHandle.sendDefinitionRequest(document.uri, firstPosition),
    );
    expect(firstDefinitions.some((location) =>
      getLocationUri(location) === document.uri &&
      getLocationStart(location).line === document.positionAt(
        document.getText().indexOf("helper(value: string)"),
      ).line
    )).toBe(false);

    const updatedDocument = await serverHandle.updateTextDocument(document.uri, [{
      range: {
        start: document.positionAt(document.getText().indexOf("./not-helper.ts")),
        end: document.positionAt(
          document.getText().indexOf("./not-helper.ts") + "./not-helper.ts".length,
        ),
      },
      newText: "./helper.ts",
    }]);
    await serverHandle.didChangeWatchedFiles([{
      uri: updatedDocument.uri,
      type: 2,
    }]);

    const nextPosition = updatedDocument.positionAt(
      updatedDocument.getText().indexOf("helper(\"ok\")") + 1,
    );
    const definitions = normalizeLocations(
      await serverHandle.sendDefinitionRequest(updatedDocument.uri, nextPosition),
    );

    expect(definitions.some((location) => getLocationUri(location) === updatedDocument.uri))
      .toBe(true);
  });

  it("refreshes same-file import resolution after a document-only file comment edit", async () => {
    const document = await serverHandle.openInMemoryDocument(
      fixtureUri("document-refreshable.featuretype"),
      "featuretype",
      [
        "# Refreshable",
        "",
        "```ts",
        "// ./root.ts",
        "import { helper } from \"./helper\"",
        "",
        "export const root = helper(\"ok\")",
        "```",
        "",
        "```ts",
        "// ./not-helper.ts",
        "export function helper(value: string) {",
        "  return value.toUpperCase()",
        "}",
        "```",
      ].join("\n"),
    );
    const firstPosition = document.positionAt(document.getText().indexOf("helper(\"ok\")") + 1);
    const firstDefinitions = normalizeLocations(
      await serverHandle.sendDefinitionRequest(document.uri, firstPosition),
    );
    expect(firstDefinitions.some((location) => getLocationUri(location) === document.uri))
      .toBe(false);

    const updatedDocument = await serverHandle.updateTextDocument(document.uri, [{
      range: {
        start: document.positionAt(document.getText().indexOf("./not-helper.ts")),
        end: document.positionAt(
          document.getText().indexOf("./not-helper.ts") + "./not-helper.ts".length,
        ),
      },
      newText: "./helper.ts",
    }]);
    const nextPosition = updatedDocument.positionAt(
      updatedDocument.getText().indexOf("helper(\"ok\")") + 1,
    );
    const definitions = normalizeLocations(
      await serverHandle.sendDefinitionRequest(updatedDocument.uri, nextPosition),
    );

    expect(definitions.some((location) => getLocationUri(location) === updatedDocument.uri))
      .toBe(true);
  });

  it("resolves extensionless same-file imports and package imports through TypeScript", async () => {
    const document = await serverHandle.openInMemoryDocument(
      fixtureUri("package-import.featuretype"),
      "featuretype",
      [
        "# Package Import",
        "",
        "```ts",
        "// ./root.ts",
        "import type { ReactNode } from \"react\"",
        "import { helper } from \"./helper\"",
        "",
        "export const acceptsNode = (value: ReactNode) => helper(value)",
        "```",
        "",
        "```ts",
        "// ./helper.ts",
        "export const helper = <Value>(value: Value) => value",
        "```",
      ].join("\n"),
    );
    const diagnostics = await serverHandle.sendDocumentDiagnosticRequest(document.uri);
    if (diagnostics.kind !== "full") {
      throw new Error("Expected a full diagnostic report.");
    }

    const reactNodePosition = document.positionAt(
      document.getText().indexOf("ReactNode") + 1,
    );
    const hover = await serverHandle.sendHoverRequest(document.uri, reactNodePosition);

    expect(diagnostics.items).toEqual([]);
    expect(formatHover(hover)).toContain("ReactNode");
  });
});

function normalizeLocations(
  definitions: Location | Location[] | LocationLink[] | null,
): Array<Location | LocationLink> {
  if (!definitions) {
    return [];
  }
  return Array.isArray(definitions) ? definitions : [definitions];
}

function getLocationUri(location: Location | LocationLink) {
  return "targetUri" in location ? location.targetUri : location.uri;
}

function getLocationStart(location: Location | LocationLink) {
  return "targetRange" in location
    ? location.targetRange.start
    : location.range.start;
}

function isDocumentSymbol(
  symbol: DocumentSymbol | SymbolInformation,
): symbol is DocumentSymbol {
  return "selectionRange" in symbol;
}

function formatHover(hover: Awaited<ReturnType<LanguageServerHandle["sendHoverRequest"]>>) {
  if (!hover) {
    return "";
  }
  if (typeof hover.contents === "string") {
    return hover.contents;
  }
  if (Array.isArray(hover.contents)) {
    return hover.contents
      .map((content) => typeof content === "string" ? content : content.value)
      .join("\n\n");
  }
  return hover.contents.value;
}
