import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import { expect, test as baseTest } from "vite-plus/test";
import {
  type Arrange,
  arrangeFixture,
  connectScenarioSession,
  responsesRoot,
  warmFixtureProjects,
} from "./runner.ts";

/**
 * Every id captured this run, in execution order. A duplicate would silently
 * overwrite another case, so `capture` refuses one; the suite's final test
 * snapshots this set as `responses/manifest.txt` — the corpus's own table of
 * contents, which docs generation and distribution replay enumerate.
 */
export const capturedIds = new Set<string>();

/**
 * One case: invoke the tool, snapshot the call and the response together.
 *
 * The test's own name is the case name, so a case is a canonical `it(...)`
 * one-liner and nothing is declared twice: the docs derive the invocation
 * from `responses/<tool>/<name>.call.json` — a record of what actually ran,
 * snapshot-gated like the response beside it. `facet` distinguishes several
 * captures inside one test; `arrange` dirties the fixture for this call and
 * restores it byte-true, and rides in the call record so the distribution
 * replay can arrange identically. The response comes back to the test, so a
 * case can go on to assert the property it exists to witness.
 */
type Capture = (
  tool: string,
  argument: Record<string, unknown>,
  options?: { readonly facet?: string; readonly arrange?: Arrange },
) => Promise<string>;

/**
 * The scenario test: `session` is one real stdio server per test file,
 * connected on first use, warmed over every fixture project, and closed by
 * the fixture's own cleanup. The warm-up is load-bearing: several answers
 * embed loaded-project state, and some engine paths answer false empties
 * against cold projects — without it, captures depended on which scenarios
 * happened to run first, and any `-t` subset diverged from the full suite.
 * `capture` is a per-test fixture already bound to the session and the
 * test's own name. This module is for test files only — the runner stays
 * importable by plain scripts (distribution verification), which must not
 * touch `vitest`.
 */
export const scenarioTest = baseTest
  .extend("session", { scope: "file" }, async ({}, { onCleanup }) => {
    const session = await connectScenarioSession();
    onCleanup(() => session.close());
    await warmFixtureProjects(session);
    return session;
  })
  // `expect` is not among vitest's built-in fixture dependencies (`task` is);
  // the global expect is sound here because the suite runs sequentially —
  // only concurrent tests need the context-local one for snapshots.
  .extend("capture", ({ session, task }): Capture => {
    return async (tool, argument, options) => {
      const id = `${tool}/${task.name}${options?.facet ? `.${options.facet}` : ""}`;
      if (capturedIds.has(id)) throw new Error(`Case id "${id}" is already captured this run.`);
      capturedIds.add(id);
      const committed = await readFile(resolve(responsesRoot, `${id}.txt`), "utf8").catch(
        () => undefined,
      );
      const restore = options?.arrange ? await arrangeFixture(options.arrange) : undefined;
      try {
        const { text: response, elapsed } = await session.call(tool, argument);
        // A capture that differs from the committed corpus prints itself into
        // the run output — new and changed responses are exactly the ones a
        // developing agent must read, and the run stream is where they are
        // read. Unchanged captures stay silent; echoing all of them would
        // drown the signal in hundreds of unchanged lines. A changed capture
        // also carries its diff: the full response is how presentation is
        // judged, the diff is what an accepting `-u` run is agreeing to — and
        // `-u` otherwise shows no diff at all at the one irreversible step.
        if (committed === undefined || committed.trimEnd() !== response.trimEnd()) {
          const diff =
            committed === undefined
              ? ""
              : `\n${createTwoFilesPatch(`${id} (committed)`, `${id} (this run)`, committed, response)}`;
          console.log(
            `── ${id} ${committed === undefined ? "(new)" : "(changed)"} ──\n${response}\n${diff}`,
          );
        }
        await expect(
          `${JSON.stringify(
            {
              tool,
              arguments: argument,
              ...(options?.arrange ? { arrange: options.arrange } : {}),
              ...(elapsed === undefined ? {} : { elapsed }),            },
            null,
            2,
          )}\n`,
        ).toMatchFileSnapshot(`responses/${id}.call.json`);
        await expect(response).toMatchFileSnapshot(`responses/${id}.txt`);
        return response;
      } finally {
        await restore?.();
      }
    };
  });
