import { afterAll, beforeAll, expect, test } from "vitest";
import { scenarios } from "./cases.ts";
import { arrangeFixture, connectScenarioSession, ensureFixtureInstalled } from "./runner.ts";

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

/**
 * The tool surface itself, as the server advertises it over `tools/list` —
 * names and titles. Documentation derives tool titles from this capture, so
 * a renamed tool changes the docs in the same commit or fails the gate.
 */
test("tool catalog", { timeout: 60_000 }, async () => {
  const catalog = await session.catalog();
  await expect(`${JSON.stringify(catalog, null, 2)}\n`).toMatchFileSnapshot(
    "responses/tool-catalog.json",
  );
});

for (const scenario of scenarios) {
  test(`${scenario.tool} · ${scenario.name}`, { timeout: 120_000 }, async () => {
    const restore = scenario.arrange ? await arrangeFixture(scenario.arrange) : undefined;
    try {
      const response = await session.invoke(scenario.tool, scenario.arguments);
      await expect(response).toMatchFileSnapshot(
        `responses/${scenario.tool}/${scenario.name}.txt`,
      );
    } finally {
      restore?.();
    }
  });
}
