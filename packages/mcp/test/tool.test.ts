import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { expect, test, vi } from "vitest";
import { registerTool } from "../src/tool.ts";

test("ends tool calls at the server deadline without closing the session", async () => {
  const server = new McpServer({ name: "type-atlas-test", version: "1.0.0" });
  registerTool(
    server,
    "wait",
    { inputSchema: type({}).onUndeclaredKey("reject") },
    () => new Promise<never>(() => {}),
  );
  registerTool(
    server,
    "echo",
    { inputSchema: type({ text: "string" }).onUndeclaredKey("reject") },
    ({ text }) => ({ content: [{ type: "text", text }] }),
  );

  const client = new Client({ name: "type-atlas-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    const nativeTimeout = AbortSignal.timeout;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => nativeTimeout(1));
    const result = await client.callTool({ name: "wait", arguments: {} });
    timeout.mockRestore();

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/timeout/i) }],
    });
    await expect(
      client.callTool({ name: "echo", arguments: { text: "ready" } }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "ready" }],
    });
  } finally {
    vi.restoreAllMocks();
    await Promise.allSettled([client.close(), server.close()]);
  }
});
