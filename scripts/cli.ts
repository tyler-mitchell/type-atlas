/**
 * The shared repository CLI: release, product, and repo-process automation
 * with real logic — the steps that are not a single program invocation and
 * are not toolchain work. Vite+ (`vp run`, `run.tasks`) stays the primary
 * command surface; this CLI is secondary and never wraps lint, test, build,
 * or typecheck.
 *
 * Every command here is reachable through a root package.json script, which
 * is the only sanctioned way to invoke it.
 */
import { defineCommand, runMain } from "citty";
import status from "./commands/status.ts";
import stopDevServers from "./commands/stop-dev-servers.ts";
import verifyPublished from "./commands/verify-published.ts";
import version from "./commands/version.ts";

const main = defineCommand({
  meta: {
    name: "repo",
    description: "Release, product, and repo-process automation for the Type Atlas suite.",
  },
  subCommands: {
    status,
    "stop-dev-servers": stopDevServers,
    "verify-published": verifyPublished,
    version,
  },
});

await runMain(main);
