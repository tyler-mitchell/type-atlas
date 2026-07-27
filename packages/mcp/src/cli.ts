import { defineCommand, runMain } from "citty";
import { startMcpServer } from "./server.ts";

const command = defineCommand({
  meta: {
    name: "typeatlas",
    description: "Run the TypeAtlas MCP server over stdio.",
  },
  run: startMcpServer,
});

await runMain(command);
