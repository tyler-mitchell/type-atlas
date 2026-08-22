import { defineCommand } from "citty";
import findProcess from "find-process";
import { killEmAll } from "kill-em-all";

export default defineCommand({
  meta: { name: "dev-stop", description: "Stop attached development servers." },
  async run() {
    const processes = await findProcess(
      "name",
      /packages[\\/]mcp[\\/]src[\\/]cli\.ts|packages[\\/]language-server[\\/]src[\\/]node\.ts/u,
      { logLevel: "error" },
    );
    const pids = new Set(processes.map(({ pid }) => pid));
    await Promise.all(
      processes.filter(({ ppid }) => !pids.has(ppid)).map(({ pid }) => killEmAll(pid)),
    );
  },
});
