import {
  GetMatchTsConfigRequest,
  SymbolKind,
  WorkspaceSymbolRequest,
} from "@volar/language-server/protocol.js";
import { expect, test, vi } from "vitest";
import { createTypeAtlas } from "../src/operations.ts";
import type { VolarWorkspace } from "../src/volar-workspace.ts";

test("keeps workspace symbol results within source-code files", async () => {
  const sendRequest = vi.fn(async (request) => {
    if (request === GetMatchTsConfigRequest.type) return null;
    if (request === WorkspaceSymbolRequest.type) {
      return [
        {
          name: "TimelineCompositionAtInput",
          kind: SymbolKind.Class,
          location: { uri: "file:///workspace/source.ts" },
        },
        {
          name: "## unrelated markdown heading",
          kind: SymbolKind.String,
          location: { uri: "file:///workspace/README.md" },
        },
      ];
    }
    throw new Error("Unexpected request");
  });
  const workspace = {
    getTextDocument: async () => ({ uri: "file:///workspace/source.ts" }),
    sendRequest,
  } as unknown as VolarWorkspace;

  const result = await createTypeAtlas(workspace).workspaceSymbols(
    "source.ts",
    "TimelineCompositionAtInput",
    new AbortController().signal,
  );

  expect(result.symbols?.map(({ name }) => name)).toEqual(["TimelineCompositionAtInput"]);
});
