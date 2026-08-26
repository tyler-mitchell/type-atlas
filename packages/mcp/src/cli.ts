import { defineCommand, runMain } from "citty";
import packageJson from "../package.json" with { type: "json" };
import { startMcpServer } from "./server.ts";

const command = defineCommand({
  meta: {
    name: "type-atlas",
    version: packageJson.version,
    description: "Run the Type Atlas MCP server over stdio.",
  },
  args: {
    "require-intent": {
      type: "boolean",
      default: false,
      description: "Require concise intent for information-gathering tools.",
    },
  },
  run: startMcpServer,
});

await runMain(command);
