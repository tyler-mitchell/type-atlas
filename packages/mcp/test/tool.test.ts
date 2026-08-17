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

    // Naming the tool and saying the work continues is the whole value here: an
    // agent told only that something timed out repeats the call, which is the
    // one response that makes a busy language server worse.
    expect(result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: expect.stringMatching(/^wait did not answer within .*still working/s) },
      ],
    });
    // Every answer carries what the call cost on its last line, so the text is
    // matched by what the tool said rather than by equality.
    await expect(
      client.callTool({ name: "echo", arguments: { text: "ready" } }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringMatching(/^ready\n\n· \d+ms$/) }],
    });
  } finally {
    vi.restoreAllMocks();
    await Promise.allSettled([client.close(), server.close()]);
  }
});
