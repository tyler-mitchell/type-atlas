import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createVolarWorkspaces } from "@type-atlas/core";
import { serverInfo, serverInstructions } from "./metadata.ts";
import { createSemble, type Semble } from "./semble.ts";
import { registerTools } from "./tools.ts";

const createServer = (
  workspaces: ReturnType<typeof createVolarWorkspaces>,
  semble: Semble,
): McpServer => {
  const server = new McpServer(serverInfo, {
    instructions: serverInstructions,
    capabilities: { tools: { listChanged: false } },
    cacheHints: {
      "tools/list": { ttlMs: 60_000, cacheScope: "public" },
    },
  });
  registerTools(server, workspaces, semble);
  return server;
};

/** Starts the MCP server over standard input and output. */
export const startMcpServer = (): void => {
  const workspaces = createVolarWorkspaces(
    new URL(import.meta.resolve("@type-atlas/language-server/node")),
  );
  const semble = createSemble();
  const handle = serveStdio(() => createServer(workspaces, semble), {
    onerror: (error) => console.error(error),
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void handle
      .close()
      .finally(() => Promise.allSettled([workspaces.dispose(), semble.dispose()]))
      .then(
        () => process.exit(0),
        (error) => {
          console.error(error);
          process.exit(1);
        },
      );
  };
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};
