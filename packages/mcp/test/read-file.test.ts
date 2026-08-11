import type { VolarWorkspacePool } from "@type-atlas/core";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { expect, test } from "vitest";
import { registerReadFileTool } from "../src/read_file.tool.ts";

const source = "const first = 1;\nconst second = 2;\nconst third = 3;\n";

const connect = async () => {
  const server = new McpServer({ name: "type-atlas-test", version: "1.0.0" });
  const workspace = {
    getTextDocument: async () => ({ uri: "file:///workspace/source.ts" }),
    readTextDocument: async () => ({
      textDocument: { uri: "file:///workspace/source.ts" },
      source,
    }),
    getWorkspaceUri: () => "file:///workspace/source.ts",
    sendRequest: async (request: unknown) => {
      const method =
        request && typeof request === "object" && "method" in request ? request.method : undefined;
      if (method === "type-atlas/fileSizes") return [source.length];
      if (method === "textDocument/foldingRange") return [];
      return null;
    },
  };
  registerReadFileTool(server, {
    get: async () => workspace,
  } as unknown as VolarWorkspacePool);

  const client = new Client({ name: "type-atlas-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
};

const textOf = (result: { content?: readonly { type: string; text?: string }[] }) =>
  (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

test("reads a file view sent as a JSON-encoded string", async () => {
  const { client, close } = await connect();
  try {
    const encoded = await client.callTool({
      name: "read_file",
      arguments: {
        workspace: "/workspace",
        file: JSON.stringify({ path: "source.ts", startLine: 2, endLine: 2, fold: false }),
      },
    });
    const direct = await client.callTool({
      name: "read_file",
      arguments: {
        workspace: "/workspace",
        file: { path: "source.ts", startLine: 2, endLine: 2, fold: false },
      },
    });

    expect(textOf(encoded)).toContain("const second = 2;");
    expect(textOf(encoded)).not.toContain("const first");
    expect(textOf(encoded)).toEqual(textOf(direct));
  } finally {
    await close();
  }
});

test("rejects a JSON-encoded string that is not a file view", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({
      name: "read_file",
      arguments: { workspace: "/workspace", file: JSON.stringify({ nope: 1 }) },
    });

    expect(textOf(result)).toContain("file must be a path");
  } finally {
    await close();
  }
});
