import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerObservabilityTools } from "./tools.ts";
import { createVolarWorkspaces } from "./volar-workspace.ts";

/** Owns the MCP server lifecycle. */
export type McpRuntime = {
  server: McpServer;
  dispose(): Promise<void>;
};

/** Creates an MCP runtime backed by isolated Volar workspace sessions. */
export const createMcpRuntime = (): McpRuntime => {
  const workspaces = createVolarWorkspaces();
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

  registerObservabilityTools(server, workspaces);

  return {
    server,
    async dispose() {
      await workspaces.dispose();
      await server.close();
    },
  };
};

/** Starts the MCP server over standard input and output. */
export const startMcpServer = async (): Promise<void> => {
  const runtime = createMcpRuntime();
  await runtime.server.connect(new StdioServerTransport());

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void runtime.dispose().finally(() => process.exit(0));
  };
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};
