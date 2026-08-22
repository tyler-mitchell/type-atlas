import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { VolarWorkspacePool } from "@type-atlas/core";
import { expect, test, vi } from "vite-plus/test";
import { createRetrievalIntelligence } from "../src/intelligence.ts";
import type { Semble } from "../src/semble.ts";

const root = join(import.meta.dirname, "workspace");
const file = "src/index.ts";
const uri = pathToFileURL(join(root, file)).href;
const source = "export const target = () => {};\n";

const documentSymbol = {
  name: "target",
  kind: 13,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 31 } },
  selectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
};

const workspaceStub = () => ({
  getTextDocument: vi.fn(async () => ({ uri })),
  readTextDocument: vi.fn(async () => ({ textDocument: { uri }, source })),
  readTextDocumentUri: vi.fn(async () => ({ source })),
  getWorkspaceUri: vi.fn(() => uri),
  sendRequest: vi.fn(async (request: unknown) => {
    const method =
      request && typeof request === "object" && "method" in request ? request.method : undefined;
    if (method === "textDocument/documentSymbol") return [documentSymbol];
    if (method === "tsserver/matchTsConfig")
      return { uri: pathToFileURL(join(root, "tsconfig.json")).href };
    return null;
  }),
});

const intelligenceWith = (semble: Pick<Semble, "findRelated">) => {
  const workspace = workspaceStub();
  return createRetrievalIntelligence({
    semble: semble as Semble,
    workspaces: { get: async () => workspace } as unknown as VolarWorkspacePool,
  });
};

test("explore_symbol keeps the inspection when similarity retrieval is unavailable", async () => {
  const intelligence = intelligenceWith({
    findRelated: vi.fn(async () => {
      throw new Error("Semantic search requires uvx.");
    }),
  });

  const text = await intelligence.exploreSymbol({
    root,
    file,
    target: { symbol: "target" },
    includeSource: false,
    includeTypeDefinitions: false,
    limit: 12,
    relatedLimit: 3,
    snippetLines: 6,
    signal: new AbortController().signal,
  });

  expect(text).toContain("target");
  expect(text).toContain("src/index.ts");
  expect(text).toContain("Related code unavailable · Semantic search requires uvx.");
});

test("explore_symbol still fails when the request is cancelled", async () => {
  const controller = new AbortController();
  const intelligence = intelligenceWith({
    findRelated: vi.fn(async () => {
      controller.abort();
      throw new Error("Request was cancelled.");
    }),
  });

  await expect(
    intelligence.exploreSymbol({
      root,
      file,
      target: { symbol: "target" },
      includeSource: false,
      includeTypeDefinitions: false,
      limit: 12,
      relatedLimit: 3,
      snippetLines: 6,
      signal: controller.signal,
    }),
  ).rejects.toThrow("Request was cancelled.");
});
