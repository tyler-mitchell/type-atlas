import { afterAll, beforeAll, expect, test } from "vitest";
import { scenarios } from "./cases.ts";
import { connectScenarioSession, ensureFixtureInstalled } from "./runner.ts";

/**
 * Every predefined scenario, through one real server, in declaration order.
 * `vitest -u` regenerates the committed responses after a deliberate change;
 * the diff under `responses/` is then reviewed like code, because it is what
 * both regression comparison and documentation examples read.
 */
let session: Awaited<ReturnType<typeof connectScenarioSession>>;

beforeAll(async () => {
  ensureFixtureInstalled();
  session = await connectScenarioSession();
}, 120_000);

afterAll(async () => {
  await session?.close();
});

for (const scenario of scenarios) {
  test(`${scenario.tool} · ${scenario.name}`, { timeout: 120_000 }, async () => {
    const response = await session.invoke(scenario.tool, scenario.arguments);
    await expect(response).toMatchFileSnapshot(
      `responses/${scenario.tool}/${scenario.name}.txt`,
    );
  });
}
