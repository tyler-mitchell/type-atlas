import { defineCommand } from "citty";
import { execa } from "execa";

export default defineCommand({
  meta: { name: "github-configure", description: "Configure GitHub release automation." },
  async run() {
    const { stdout } = await execa("gh", ["auth", "token"]);
    await execa("gh", ["secret", "set", "BUMPY_GH_TOKEN", "--body", stdout.trim()], {
      stdout: "inherit",
      stderr: "inherit",
    });
  },
});
