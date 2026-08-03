import {
  CompletionItemKind,
  CompletionItemTag,
  SymbolKind,
} from "@volar/language-server/protocol.js";
import { expect, test } from "vitest";
import type { ModuleExportPage } from "../src/module-exports.ts";
import { formatModuleExports, formatWorkspaceSymbols } from "../src/plain-text.ts";

test("formats resolved module exports as TypeScript declarations with JSDoc", () => {
  const page: ModuleExportPage = {
    module: "example",
    path: [],
    surface: "runtime",
    query: "",
    isIncomplete: false,
    total: 1,
    offset: 0,
    items: [
      {
        label: "createExample",
        kind: CompletionItemKind.Function,
        detail: "(alias) function createExample(): void\nexport createExample",
        documentation: "Creates an example.",
        tags: [CompletionItemTag.Deprecated],
      },
    ],
    definitionUris: [],
    subpaths: [],
    includeDocs: true,
  };

  expect(formatModuleExports(page)).toContain(
    "```ts\n/**\n * @deprecated\n * Creates an example.\n */\nexport function createExample(): void\n```",
  );
});

test("bounds workspace symbol labels to one output line", () => {
  const text = formatWorkspaceSymbols(
    {
      items: [
        {
          name: `heading\n${"compiled".repeat(40)}`,
          kind: SymbolKind.String,
          location: {
            uri: "file:///workspace/source.ts",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
          containerName: "container\nname",
        },
      ],
      total: 1,
      offset: 0,
    },
    "/workspace",
  );

  expect(text.split("\n")).toHaveLength(2);
  expect(text).toContain("heading compiled");
  expect(text).toContain("… [string]");
  expect(text).toContain("— container name");
  expect(text.length).toBeLessThan(300);
});
