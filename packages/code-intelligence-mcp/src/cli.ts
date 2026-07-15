import { defineCommand, runMain } from "citty";
import { startMcpServer } from "./server.ts";

const command = defineCommand({
  meta: {
    name: "code-intelligence-mcp",
    description: "Run Code Intelligence MCP over stdio.",
  },
  run: startMcpServer,
});

await runMain(command);
