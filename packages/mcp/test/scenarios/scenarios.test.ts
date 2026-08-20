import { expect, test } from "vitest";
import { scenarios } from "./cases.ts";
import { arrangeFixture } from "./runner.ts";
import { scenarioTest } from "./scenario-test.ts";

/**
 * Every predefined scenario, through one real server, in declaration order.
 * `vitest -u` regenerates the committed responses after a deliberate change;
 * the diff under `responses/` is then reviewed like code, because it is what
 * both regression comparison and the generated documentation read.
 */

/**
 * The tool surface itself, as the server advertises it over `tools/list` —
 * names, titles, and descriptions. Documentation derives tool identity from
 * this capture, so a renamed tool changes the docs in the same commit or
 * fails the gate.
 */
scenarioTest("tool catalog", { timeout: 120_000 }, async ({ session, expect }) => {
  const catalog = await session.catalog();
  await expect(`${JSON.stringify(catalog, null, 2)}\n`).toMatchFileSnapshot(
    "responses/tool-catalog.json",
  );
});

scenarioTest.for(scenarios)(
  "$tool · $name",
  { timeout: 120_000 },
  async (scenario, { session, expect }) => {
    const restore = scenario.arrange ? await arrangeFixture(scenario.arrange) : undefined;
    try {
      const response = await session.invoke(scenario.tool, scenario.arguments);
      await expect(response).toMatchFileSnapshot(
        `responses/${scenario.tool}/${scenario.name}.txt`,
      );
    } finally {
      restore?.();
    }
  },
);

/**
 * A scenario id names one case exactly once; a duplicate would silently
 * overwrite another case's capture.
 */
test("scenario ids are unique", () => {
  const ids = scenarios.map(({ tool, name }) => `${tool}/${name}`);
  expect(new Set(ids).size).toBe(ids.length);
});
