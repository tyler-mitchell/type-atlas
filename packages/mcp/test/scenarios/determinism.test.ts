/**
 * The determinism gate: the captured corpus, replayed in seeded-random order,
 * must reproduce its committed baselines byte for byte.
 *
 * A stateful code-intelligence server's answers are secretly functions of
 * session history — this repository caught verify_edit poisoning navigation,
 * and upstream sections that appear or vanish with warmth. Nothing else in
 * this category even measures that. This gate makes order-independence a
 * TESTED INVARIANT: any answer that depends on what ran before it fails its
 * baseline here under some shuffle, and the seed in the failure message
 * replays that exact order.
 *
 * The hazard corner is excluded — those cases are quarantined *because* they
 * are order-sensitive (docs/issues.md carries each diagnosis), and the
 * boundary between "proven order-free" and "known hazards" is exactly what
 * this gate patrols: shrinking QUARANTINED is progress, growing it needs a
 * ledger entry.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  arrangeFixture,
  capturedScenarios,
  connectScenarioSession,
  ensureFixtureRepository,
  responsesRoot,
  warmFixtureProjects,
} from "./runner.ts";

/** Order-sensitive by diagnosis; each has its story in docs/issues.md. */
const QUARANTINED = new Set([
  "document_links/fixture-readme",
  "find_successor/renamed-method-hunch",
  "find_successor/close-miss-finds-the-successor",
  "find_successor/test-residue-is-not-a-capability",
  "verify_edit/proposed-edit-breaks-a-consumer",
  // Caught by this gate (seed 2005945456): the implementations walk reaches
  // only session-opened files, so the section comes and goes with call
  // order. Leaves when the walk gets a deterministic scope.
  "inspect_symbol/money-type",
  // Caught by this gate (seed 1308991141): the engine's fixMissingImport
  // family answers only in sessions with the right history — the ledger
  // already held this from manual observation; now it has a seed.
  "add_missing_imports/forgotten-imports",
  // A declared session mutator, not a defect (seed 502862052): impact's whole
  // design is loading consumer projects, so every scope disclosure after it
  // honestly says a bigger number. The canonical order runs it late; shuffled
  // ahead of a scope-disclosing case it changes that case's true answer.
  "impact/weigh-a-change-to-signed-amount",
  "impact/weigh-a-change-to-a-shared-type",
  // Caught by this gate flapping WITHIN one seed (502862052): the ambient
  // diagnostics line ("1 problem in …") attaches when a background check
  // happens to have finished — time-dependent, not order-dependent. Leaves
  // with the raised diagnostics rework (docs/issues.md).
  "type_definitions/call-result-to-alias",
]);

// Small seeded PRNG (mulberry32) — enough to make a failing order
// reproducible from its logged seed; no dependency earns its keep for this.
const mulberry32 = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shuffled = <T>(items: readonly T[], seed: number): T[] => {
  const random = mulberry32(seed);
  const order = [...items];
  for (let last = order.length - 1; last > 0; last -= 1) {
    const pick = Math.floor(random() * (last + 1));
    [order[last], order[pick]] = [order[pick]!, order[last]!];
  }
  return order;
};

test("every answer is order-independent under a shuffled replay", async () => {
  // A fresh seed per run makes this a standing fuzzer; pin one to replay a
  // failure. The fixture repository is rebuilt here because a standalone
  // `--project=determinism` run owes the git-marker cases their repo.
  const seed = process.env.TYPE_ATLAS_SHUFFLE_SEED
    ? Number(process.env.TYPE_ATLAS_SHUFFLE_SEED)
    : Math.floor(Math.random() * 2 ** 31);
  console.log(`shuffled replay seed: ${seed} (TYPE_ATLAS_SHUFFLE_SEED=${seed} replays this order)`);

  await ensureFixtureRepository();
  const corpus = (await capturedScenarios()).filter(({ id }) => !QUARANTINED.has(id));
  expect(corpus.length).toBeGreaterThan(0);

  const session = await connectScenarioSession();
  try {
    // The gate's first-ever run caught this line's absence: answers disclose
    // their scope ("N projects loaded"), so the corpus is deterministic only
    // relative to the warmed session state every capture runs under.
    await warmFixtureProjects(session);
    const executed: string[] = [];
    for (const scenario of shuffled(corpus, seed)) {
      const restore = scenario.arrange ? await arrangeFixture(scenario.arrange) : undefined;
      try {
        const answer = await session.invoke(scenario.tool, scenario.arguments);
        const committed = await readFile(resolve(responsesRoot, `${scenario.id}.txt`), "utf8");
        // Failure stays terse — seed and victim. The suspect prefix prints
        // only on a deliberate replay (pinned seed), because the cause ran
        // earlier and that is when someone is actually hunting it.
        if (answer !== committed && process.env.TYPE_ATLAS_SHUFFLE_SEED) {
          console.log(`── order until divergence ──\n${executed.join("\n")}`);
        }
        expect(answer, `${scenario.id} diverged under shuffle (seed ${seed})`).toBe(committed);
        executed.push(scenario.id);
      } finally {
        await restore?.();
      }
    }
  } finally {
    await session.close();
  }
}, 300_000);
