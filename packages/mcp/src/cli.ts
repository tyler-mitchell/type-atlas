import { defineCommand, runMain } from "citty";
import { startMcpServer } from "./server.ts";

const command = defineCommand({
  meta: {
    name: "typeatlas",
    description: "Run the Type Atlas MCP server over stdio.",
  },
  run: startMcpServer,
});

await runMain(command);
