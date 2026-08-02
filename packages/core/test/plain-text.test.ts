import { CompletionItemKind, CompletionItemTag } from "@volar/language-server/protocol.js";
import { expect, test } from "vitest";
import type { ModuleExportPage } from "../src/module-exports.ts";
import { formatModuleExports } from "../src/plain-text.ts";

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
