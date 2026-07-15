import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerObservabilityTools } from "./observability.ts";

/** Owns the MCP server lifecycle. */
export type McpRuntime = {
  server: McpServer;
  dispose(): Promise<void>;
};

/** Creates an MCP runtime backed by a fresh Volar project per tool call. */
export const createMcpRuntime = (): McpRuntime => {
  const server = new McpServer(
    {
      name: "Code Intelligence MCP",
      version: "0.0.0",
    },
    {
      instructions:
        "Use an absolute workspace root. A file may be workspace-relative or absolute within that root. Positions and ranges are literal LSP coordinates: zero-based lines and UTF-16 characters. Results preserve the same coordinates.",
    },
  );

  registerObservabilityTools(server);

  return {
    server,
    async dispose() {
      await server.close();
    },
  };
};

/** Starts the MCP server over standard input and output. */
export const startMcpServer = async (): Promise<void> => {
  const runtime = createMcpRuntime();
  await runtime.server.connect(new StdioServerTransport());

  const shutdown = (): void => {
    void runtime.dispose().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};
