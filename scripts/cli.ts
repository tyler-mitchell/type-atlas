/**
 * The shared repository CLI: release and product automation with real logic —
 * the steps that are not a single program invocation and are not toolchain
 * work. Vite+ (`vp run`, `run.tasks`) remains the primary command surface;
 * this CLI is secondary to it and must never grow monorepo tooling concerns —
 * no wrapping of lint, test, build, or typecheck.
 *
 * Every command here is reachable through a root package.json script, which
 * is the only sanctioned way to invoke it.
 */
import { defineCommand, runMain } from "citty";
import status from "./commands/status.ts";
import version from "./commands/version.ts";

const main = defineCommand({
  meta: {
    name: "repo",
    description: "Release and product automation for the Type Atlas suite.",
  },
  subCommands: { status, version },
});

await runMain(main);
