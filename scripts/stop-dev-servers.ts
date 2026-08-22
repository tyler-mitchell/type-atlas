import { spawnSync } from "node:child_process";

for (const pattern of ["packages/mcp/src/cli.ts", "language-server/src/node.ts"]) {
  const { status } = spawnSync("pkill", ["-f", pattern], { stdio: "inherit" });
  if (status !== null && status > 1) process.exit(status);
}
