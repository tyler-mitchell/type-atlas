import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Paths only — imported by the runner, the docs renderer, and the project's
 * `globalSetup`, which runs outside the test context and therefore must not
 * reach anything that imports `vitest`.
 */
export const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The realistic monorepo every scenario runs against. See its README. */
export const fixtureRoot = resolve(packageRoot, "../../fixtures/ledger");
