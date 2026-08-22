import { fileURLToPath, pathToFileURL } from "node:url";
import { normalize, resolve } from "pathe";
import { CompletionItemKind } from "vscode-languageserver-protocol";
import { expect, test, vi } from "vite-plus/test";
import type { VolarWorkspacePool } from "@type-atlas/core";
import { createDependencySearch } from "../src/dependency-search.ts";
import type { Semble } from "../src/semble.ts";

/**
 * A file that exists, because finding a package root reads the disk.
 *
 * The language server answers where a module resolved to, and `pkg-types` then
 * walks up from that file to its `package.json` — a real read, which a made-up
 * `/workspace/node_modules/example` cannot satisfy. Pointing at this package's
 * own source costs nothing to set up and exercises the real resolution instead
 * of a mock of it.
 */
const resolvedFileName = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const packageRoot = normalize(fileURLToPath(new URL("..", import.meta.url))).replace(/\/$/, "");
const workspaceRoot = resolve(packageRoot, "../..");
const sourceUri = pathToFileURL(resolve(workspaceRoot, "source.ts")).href;
const dependencyUri = pathToFileURL(
  resolve(workspaceRoot, "node_modules/example/types/index.d.ts"),
).href;

test("prefers authored package source with one search and two completion pages", async () => {
  const calls = { completion: 0, resolve: 0, search: 0 };
  const workspace = {
    getTextDocument: vi.fn(async (file: string) => ({ uri: `file://${file}` })),
    readTextDocumentUri: vi.fn(async (uri: string) => ({
      textDocument: { uri },
      source:
        "/** Creates an actor from the supplied logic. */\nexport function createActor() {}\nexport function createMachine() {}\nexport class ActorError {}\nexport function unrelated() {}",
    })),
    getWorkspaceUri: () => sourceUri,
    sendRequest: vi.fn(async (_request: unknown, params: unknown) => {
      if (
        _request &&
        typeof _request === "object" &&
        "method" in _request &&
        _request.method === "textDocument/typeDefinition"
      ) {
        return [
          {
            uri: dependencyUri,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          },
        ];
      }
      if (
        _request &&
        typeof _request === "object" &&
        "method" in _request &&
        _request.method === "textDocument/documentSymbol"
      ) {
        return [
          {
            name: "createActor",
            kind: 12,
            range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
            selectionRange: {
              start: { line: 1, character: 16 },
              end: { line: 1, character: 27 },
            },
          },
        ];
      }
      if (params && typeof params === "object" && "moduleName" in params) {
        return {
          packageId: { name: "example", subModuleName: "", version: "1.0.0" },
          resolvedFileName,
        };
      }
      if (params && typeof params === "object" && "label" in params) {
        calls.resolve += 1;
        return {
          ...params,
          detail: `function ${params.label}(): void`,
          documentation: `Creates an actor from supplied logic. ${"Additional detail. ".repeat(20)}SHOULD_NOT_APPEAR`,
          tags: params.label === "createMachine" ? [1] : undefined,
        };
      }
      calls.completion += 1;
      return [
        { label: "createActor", kind: CompletionItemKind.Function },
        { label: "createMachine", kind: CompletionItemKind.Function },
        { label: "ActorError", kind: CompletionItemKind.Class },
        { label: "unrelated", kind: CompletionItemKind.Function },
      ];
    }),
    withTextDocument: vi.fn(
      async ({ task }: { task: (document: { uri: string }) => Promise<unknown> }) =>
        await task({ uri: sourceUri }),
    ),
  };
  const semble = {
    search: vi.fn(async () => {
      calls.search += 1;
      return {
        query: "create a state machine actor",
        results: [
          {
            file_path: "src/index.ts",
            start_line: 1,
            end_line: 3,
            score: 1,
            content:
              "/** Creates an actor from the supplied logic. */\nexport function createActor() {}\nexport function createMachine() {}\nexport class ActorError {}\nexport function unrelated() {}",
          },
          {
            file_path: "dist/example.min.js",
            start_line: 1,
            end_line: 1,
            score: 2,
            content: "function createActor(){}function createMachine(){}",
          },
          {
            file_path: "types/index.d.ts",
            start_line: 1,
            end_line: 3,
            score: 1,
            content:
              "/** Creates an actor from the supplied logic. */\nexport function createActor() {}\nexport function createMachine() {}\nexport class ActorError {}\nexport function unrelated() {}",
          },
        ],
      };
    }),
  };
  const search = createDependencySearch({
    semble: semble as unknown as Semble,
    workspaces: { get: async () => workspace } as unknown as VolarWorkspacePool,
  });

  const output = await search({
    workspace: workspaceRoot,
    file: "source.ts",
    packages: ["example"],
    query: "create a state machine actor",
    path: [],
    surface: "runtime",
    limit: 2,
    snippetLines: 1,
    signal: new AbortController().signal,
  });

  // `completion` is the mock's catch-all — every request that is not a type
  // definition, an outline, a module resolution, or a label resolve lands here,
  // so it counts the declaration-locations probe as well as the export probe.
  // What the test is actually holding is the search: one, for the whole page,
  // rather than one per export.
  expect(calls).toEqual({ completion: 4, resolve: 2, search: 1 });
  expect(semble.search).toHaveBeenCalledWith(expect.objectContaining({ repo: packageRoot }));
  // An export list is scanned by name, so the name leads and its signature and
  // documentation follow it. It was a fenced TypeScript declaration block; a
  // fence marks *a* signature, as `inspect_symbol` still does for one symbol,
  // and a list of exports is a list rather than a block of code.
  expect(output).toContain("createActor: function createActor(): void");
  expect(output).toContain("Creates an actor from supplied logic.");
  expect(output).not.toContain("SHOULD_NOT_APPEAR");
  expect(output).toContain("createMachine [deprecated]: function createMachine(): void");
  expect(output).toContain("2 | export function createActor() {}");
  expect(output).toContain("src/index.ts");
  expect(output).not.toContain("example.min.js");
  expect(output).not.toContain("types/index.d.ts");
  expect(output).not.toContain("1|/** Creates an actor from the supplied logic. */");
  expect(output).not.toContain("unrelated");
  expect(output).not.toContain("ActorError");
});

test.each([
  { path: ["Effect"], type: undefined, label: "retry", display: "Effect.retry" },
  { path: [], type: "TgpuComputePipeline", label: "with", display: "TgpuComputePipeline.with" },
])("searches an explicit nested surface without recursive probes: $display", async (surface) => {
  const calls = { completion: 0, resolve: 0, search: 0 };
  const workspace = {
    getTextDocument: vi.fn(async (file: string) => ({ uri: `file://${file}` })),
    readTextDocumentUri: vi.fn(async (uri: string) => ({
      textDocument: { uri },
      source: `${surface.label}\nunrelated`,
    })),
    getWorkspaceUri: () => sourceUri,
    sendRequest: vi.fn(async (_request: unknown, params: unknown) => {
      if (
        _request &&
        typeof _request === "object" &&
        "method" in _request &&
        _request.method === "textDocument/typeDefinition"
      ) {
        return [
          {
            uri: dependencyUri,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          },
        ];
      }
      if (
        _request &&
        typeof _request === "object" &&
        "method" in _request &&
        _request.method === "textDocument/documentSymbol"
      ) {
        return [
          {
            name: surface.label,
            kind: 6,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            selectionRange: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: surface.label.length },
            },
          },
        ];
      }
      if (params && typeof params === "object" && "moduleName" in params) {
        return {
          packageId: { name: "example", subModuleName: "", version: "1.0.0" },
          resolvedFileName,
        };
      }
      if (params && typeof params === "object" && "label" in params) {
        calls.resolve += 1;
        return { ...params, detail: `function ${params.label}(): void` };
      }
      calls.completion += 1;
      return [
        { label: surface.label, kind: CompletionItemKind.Method },
        { label: "unrelated", kind: CompletionItemKind.Method },
      ];
    }),
    withTextDocument: vi.fn(
      async ({ task }: { task: (document: { uri: string }) => Promise<unknown> }) =>
        await task({ uri: sourceUri }),
    ),
  };
  const semble = {
    search: vi.fn(async () => {
      calls.search += 1;
      return {
        query: surface.label,
        results: [
          {
            file_path: "index.js",
            start_line: 1,
            end_line: 1,
            score: 1,
            content: `${surface.label}\nunrelated`,
          },
        ],
      };
    }),
  };
  const search = createDependencySearch({
    semble: semble as unknown as Semble,
    workspaces: { get: async () => workspace } as unknown as VolarWorkspacePool,
  });

  const output = await search({
    workspace: workspaceRoot,
    file: "source.ts",
    packages: ["example"],
    query: surface.label,
    path: surface.path,
    surface: "runtime",
    type: surface.type,
    limit: 1,
    snippetLines: 1,
    signal: new AbortController().signal,
  });

  expect(calls).toEqual({ completion: 2, resolve: 1, search: 2 });
  expect(semble.search).toHaveBeenCalledWith(
    expect.objectContaining({
      query: [surface.type, surface.path.join("."), surface.label].filter(Boolean).join(" "),
    }),
  );
  // A section names a part within one subject, and every section in this
  // surface is `##`. The named surface sits beside `## Relevant source` under
  // the package's banner, which is what those two are: siblings.
  expect(output).toContain(`## ${surface.type ?? surface.path.join(".")}`);
  expect(output).toContain(`${surface.label}: function ${surface.label}(): void`);
  expect(output).not.toContain("unrelated");
});

test("does not serialize independent dependency searches", async () => {
  const activity = { current: 0, maximum: 0 };
  const workspace = {
    getWorkspaceUri: () => sourceUri,
    sendRequest: vi.fn(async (_request: unknown, params: unknown) =>
      params && typeof params === "object" && "moduleName" in params
        ? {
            packageId: { name: "example", subModuleName: "", version: "1.0.0" },
            resolvedFileName,
          }
        : [],
    ),
    withTextDocument: vi.fn(
      async ({ task }: { task: (document: { uri: string }) => Promise<unknown> }) =>
        await task({ uri: sourceUri }),
    ),
  };
  const semble = {
    search: vi.fn(async () => {
      activity.current += 1;
      activity.maximum = Math.max(activity.maximum, activity.current);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activity.current -= 1;
      return { query: "query", results: [] };
    }),
  };
  const search = createDependencySearch({
    semble: semble as unknown as Semble,
    workspaces: { get: async () => workspace } as unknown as VolarWorkspacePool,
  });
  const request = {
    workspace: workspaceRoot,
    file: "source.ts",
    packages: ["example"],
    query: "query",
    path: [],
    surface: "runtime" as const,
    limit: 1,
    snippetLines: 1,
    signal: new AbortController().signal,
  };

  await Promise.all([search(request), search(request), search(request)]);

  expect(activity.maximum).toBe(3);
});
