import { defineCommand, runMain } from "citty";

import { startServer } from "./server.js";

const featureTypeCommand = defineCommand({
  meta: {
    name: "featuretype-mcp",
    description: "FeatureType MCP server",
  },
  args: {
    projectRoot: {
      type: "positional",
      required: false,
      description: "Optional project root to attach on startup",
    },
  },
  run: async ({ args }) => {
    await startServer(args.projectRoot);
  },
});

export const runCli = async (
  rawArgs: readonly string[] = process.argv.slice(2),
): Promise<void> => {
  await runMain(featureTypeCommand, { rawArgs: [...rawArgs] });
};
