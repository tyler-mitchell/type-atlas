import { defineCommand } from "citty";
import { execa } from "execa";

export default defineCommand({
  meta: { name: "registry-publish", description: "Publish and verify the MCP Registry entry." },
  async run() {
    const { stdout } = await execa("gh", ["workflow", "run", "mcp-registry.yml", "--ref", "main"]);
    const runId = /\/actions\/runs\/(\d+)/u.exec(stdout)?.[1];
    if (!runId) throw new Error(`GitHub did not return the workflow run URL: ${stdout}`);
    console.log(stdout);
    await execa("gh", ["run", "watch", runId, "--compact", "--exit-status"], {
      stdout: "inherit",
      stderr: "inherit",
    });
  },
});
