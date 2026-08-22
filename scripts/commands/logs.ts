import { defineCommand } from "citty";
import { execa } from "execa";

/**
 * Prints the failing step of the most recent Release run.
 *
 * Reading CI is part of every interrupted release, and having no task for it
 * is what sends an agent improvising `gh run list`, `gh run watch`, and
 * `gh run view --log-failed` by hand, one dialect per agent. Two calls, one
 * name.
 */
export default defineCommand({
  meta: {
    name: "logs",
    description: "Show the failing step of the latest Release workflow run.",
  },
  run: async () => {
    const { stdout } = await execa("gh", [
      "run",
      "list",
      "--workflow=release.yml",
      "--limit=1",
      "--json=databaseId,status,conclusion,headBranch",
    ]);
    const [run] = JSON.parse(stdout) as {
      databaseId: number;
      status: string;
      conclusion: string | null;
      headBranch: string;
    }[];
    if (!run) throw new Error("No Release workflow run has been recorded.");
    console.log(
      `Release run ${String(run.databaseId)} on ${run.headBranch}: ${run.status}${run.conclusion ? ` · ${run.conclusion}` : ""}`,
    );
    if (run.conclusion === "success") return;
    await execa("gh", ["run", "view", String(run.databaseId), "--log-failed"], {
      stdio: "inherit",
    });
  },
});
