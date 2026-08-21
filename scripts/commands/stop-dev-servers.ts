import { spawnSync } from "node:child_process";
import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "stop-dev-servers",
    description: `Stop every attached dev server so each client's reloader respawns it on
    current source — the cross-client ritual after protocol changes. Wrong
    tool for your own session: your reloader respawns instantly on the tree
    as it stands at kill time; use the MCP \`reload\` tool there instead.
    pkill exits 1 when nothing matched — for a stop that is success, so only
    bigger codes fail the run.
    `,
  },
  run: () => {
    for (const pattern of ["packages/mcp/src/cli.ts", "language-server/src/node.ts"]) {
      const { status } = spawnSync("pkill", ["-f", pattern], {
        stdio: "inherit",
      });
      if (status !== null && status > 1) process.exit(status);
    }
  },
});
