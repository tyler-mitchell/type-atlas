import { CompletionItemKind } from "vscode-languageserver-protocol";
import { expect, test, vi } from "vitest";
import type { VolarWorkspacePool } from "@type-atlas/core";
import { createDependencySearch } from "../src/dependency-search.ts";
import type { Semble } from "../src/semble.ts";

test("prefers authored package source with one search and two completion pages", async () => {
  const calls = { completion: 0, resolve: 0, search: 0 };
  const workspace = {
    getTextDocument: vi.fn(async (file: string) => ({ uri: `file://${file}` })),
    readTextDocumentUri: vi.fn(async (uri: string) => ({
      textDocument: { uri },
      source:
        "/** Creates an actor from the supplied logic. */\nexport function createActor() {}\nexport function createMachine() {}\nexport class ActorError {}\nexport function unrelated() {}",
    })),
    getWorkspaceUri: () => "file:///workspace/source.ts",
    sendRequest: vi.fn(async (_request: unknown, params: unknown) => {
      if (
        _request &&
        typeof _request === "object" &&
        "method" in _request &&
        _request.method === "textDocument/typeDefinition"
      ) {
        return [
          {
            uri: "file:///workspace/node_modules/example/types/index.d.ts",
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
          resolvedFileName: "/workspace/node_modules/example/index.d.ts",
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
        await task({ uri: "file:///workspace/source.ts" }),
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
    workspace: "/workspace",
    file: "source.ts",
    packages: ["example"],
    query: "create a state machine actor",
    path: [],
    surface: "runtime",
    limit: 2,
    snippetLines: 1,
    signal: new AbortController().signal,
  });

  expect(calls).toEqual({ completion: 2, resolve: 2, search: 1 });
  expect(semble.search).toHaveBeenCalledWith(
    expect.objectContaining({ repo: "/workspace/node_modules/example" }),
  );
  expect(output).toContain("```ts\n/** Creates an actor from supplied logic.");
  expect(output).toContain("export function createActor(): void");
  expect(output).not.toContain("SHOULD_NOT_APPEAR");
  expect(output).toContain("export function createMachine(): void");
  expect(output).toContain(" * @deprecated\n * Creates an actor from supplied logic.");
  expect(output).toContain("2|export function createActor() {}");
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
    getWorkspaceUri: () => "file:///workspace/source.ts",
    sendRequest: vi.fn(async (_request: unknown, params: unknown) => {
      if (
        _request &&
        typeof _request === "object" &&
        "method" in _request &&
        _request.method === "textDocument/typeDefinition"
      ) {
        return [
          {
            uri: "file:///workspace/node_modules/example/types/index.d.ts",
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
          resolvedFileName: "/workspace/node_modules/example/index.d.ts",
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
        await task({ uri: "file:///workspace/source.ts" }),
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
    workspace: "/workspace",
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
  expect(output).toContain(`### ${surface.type ?? surface.path.join(".")}`);
  expect(output).toContain(`${surface.label}(): void;`);
  expect(output).not.toContain("unrelated");
});

test("does not serialize independent dependency searches", async () => {
  const activity = { current: 0, maximum: 0 };
  const workspace = {
    getWorkspaceUri: () => "file:///workspace/source.ts",
    sendRequest: vi.fn(async (_request: unknown, params: unknown) =>
      params && typeof params === "object" && "moduleName" in params
        ? {
            packageId: { name: "example", subModuleName: "", version: "1.0.0" },
            resolvedFileName: "/workspace/node_modules/example/index.d.ts",
          }
        : [],
    ),
    withTextDocument: vi.fn(
      async ({ task }: { task: (document: { uri: string }) => Promise<unknown> }) =>
        await task({ uri: "file:///workspace/source.ts" }),
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
    workspace: "/workspace",
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
