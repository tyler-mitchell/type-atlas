import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import { execa } from "execa";
import { trustPublisher } from "./trust.ts";

type Manifest = {
  name?: string;
  private?: boolean;
  version?: string;
  publishConfig?: { access?: string };
  repository?: { url?: string };
  scripts?: Record<string, string>;
};

export default defineCommand({
  meta: {
    name: "publish-and-trust-new-package",
    description: "Publish and trust one new public npm package.",
  },
  args: {
    directory: {
      type: "positional",
      required: true,
      description: "Workspace package directory, such as packages/new-package.",
    },
  },
  run: async ({ args }) => {
    const manifest = JSON.parse(
      await readFile(resolve(args.directory, "package.json"), "utf8"),
    ) as Manifest;
    if (!manifest.name) throw new Error(`${args.directory}/package.json has no package name.`);
    if (!manifest.version) throw new Error(`${manifest.name} has no version.`);
    if (manifest.private) throw new Error(`${manifest.name} is private.`);
    if (manifest.publishConfig?.access !== "public") {
      throw new Error(`${manifest.name} must publish with public access.`);
    }
    if (!manifest.repository?.url?.includes("tyler-mitchell/type-atlas")) {
      throw new Error(`${manifest.name} has no Type Atlas repository identity.`);
    }
    const workspace = await readFile("pnpm-workspace.yaml", "utf8");
    if (!workspace.split("\n").some((line) => line.trim() === `- ${args.directory}`)) {
      throw new Error(`${manifest.name} is absent from pnpm-workspace.yaml.`);
    }
    const changesets = JSON.parse(await readFile(".changeset/config.json", "utf8")) as {
      fixed?: string[][];
    };
    if (!changesets.fixed?.flat().includes(manifest.name)) {
      throw new Error(`${manifest.name} is absent from the Changesets fixed group.`);
    }
    const mcp = JSON.parse(await readFile("packages/mcp/package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };
    if (!mcp.dependencies?.[manifest.name]?.startsWith("workspace:")) {
      throw new Error(
        `@type-atlas/mcp does not declare ${manifest.name} as a workspace dependency.`,
      );
    }
    for (const task of ["check-types", "test"] as const) {
      if (!manifest.scripts?.[task]) throw new Error(`${manifest.name} has no ${task} task.`);
      await execa("vp", ["-C", args.directory, "run", task], { stdio: "inherit" });
    }
    if (!manifest.scripts?.prepack) throw new Error(`${manifest.name} has no prepack task.`);
    await execa(
      "vp",
      ["-C", args.directory, "pm", "publish", "--access", "public", "--no-git-checks"],
      { stdio: "inherit" },
    );
    await trustPublisher(manifest.name);
    console.log(`${manifest.name} is published and trusted for GitHub Actions.`);
  },
});
