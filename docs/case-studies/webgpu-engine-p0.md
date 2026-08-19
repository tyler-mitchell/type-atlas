# webgpu-engine P0 — implementation plan, synthesized through Type Atlas

The case-study artifact: the plan an implementing agent would need, synthesized
from the architectural handoff with every anchor navigated through the MCP
against read-only kek-monorepo (2026-08-19). Anchors are one-based file:line
facts read from source; **unverified** marks what the handoff asserts but this
synthesis has not yet navigated. Order is dependency order.

## Verified ground the plan stands on

- Execution is phase-major: `makeExecutionHost.step` iterates authored step
  groups, then that group's clock crossings (execution.ts:608–627).
- Step-moment conditions are already source-classified at construction:
  a non-journaled condition at a step moment refuses with the remedy named
  (planExecution, execution.ts:314–344); schedule-backed conditions at frame
  moments refuse in the inverse direction (execution.ts:549–573); the runtime
  re-checks and reads the journal, never recomputing (encodeGroup,
  execution.ts:101–120).
- Command windows cannot settle per-execution today: `settleExecution` has
  exactly one caller, inside `reset` (compile-system-passes.ts:216). The
  window state that survives is the defect chain: the append `cursor` never
  rewinds and `count(id)` — the `perCommand` dispatch source — still reports
  a consumed batch on the next crossing (pipeline-command.ts:79–84, 420–429).
- The command-feed witness does not typecheck: `frame`/`lastFrame` do not
  exist on `WitnessEngine` (ten ts2339 sites), and `PipelineCommandContext`
  has lost `frame` and `interpolationAlpha` (command-feed.typegpu.test.ts:242).
  Its expectations are unexecutable, not merely stale.
- The inert APIs are write-only: `ResolvedSystemDeclaration.prepareHost` is
  assigned once (system.ts:1736) and read nowhere.
- `PipelineSystem.contract` is consumed only by world-engine
  (world-frame.ts ×4, world-program-compiler.ts:187) and the deprecated
  open-world-v2 example — never by the engine binding or compiler beyond its
  own construction (system.ts:1799, 1922).
- CoreTime's continuation half is real and tested: `snapshotPlanEffect`
  chooses genesis or the latest reachable snapshot with digest records and
  retained-history refusals (runtime/snapshot/plan.ts:390), and core-time's
  own suite exercises record-and-reconstruct. The engine never calls it:
  `TimelineRuntime.snapshotPlan` has five references, all core-time framework
  wiring and tests — searched with both projects loaded.
- The engine's sole continuation operation is
  `onOriginReset: () => surfacing(() => compiled.reset())` (engine.ts:527).
  Stage rides the admission gate under an explicit no-submit rule
  (engine.ts:470–508); steps submit per step (engine.ts:523); presentation
  skips deferred/refused frames (engine.ts:529–541).
- The scheduled-input seam is 19 lines (physics capability/schedule.ts:10)
  wrapped seven near-identical times in one domain (commands.ts) — the
  measured case for `defineScheduledCommand`.
- `device.lost` occurs nowhere in webgpu-engine/src (literal scan); the
  `uncapturederror` listener is engine.ts:280.
- `SystemDispatch`'s thunk form exists (system.ts:296). **Unverified**: that
  no active source uses it — the literal check queues on `occurrences`.
- The new open world (examples/src/aaa-open-world/system.ts) already composes
  purely through `definePipelineSystem` — no world-engine import at its entry.

## Task 1 — rebuild the command-feed witness, then wire settlement

The handoff sequences the witness first, and navigation hardens that: the
existing witness cannot even typecheck, so nothing about current window
behavior is execution-proven. Rebuild it on the current `WitnessEngine`
surface around execution windows (never frames), covering the handoff's seven
behaviors — single consumption, offset re-zeroing, pending-until-crossing, no
double consumption across mapped crossings, `perCommand` draining to zero,
origin reset discarding pending input, independent present/step settlement.

The rebuild's mapping is already documented at the harness itself
(witness-engine.ts:1–100): `runtime.frame()` → `advance({ ticks: N })`
(deterministic tick admission, chunked under a refuse-declared step limit);
`runtime.lastFrame()` → `lastSummary()` returning encoded/skipped counts,
with `read(id)` for data assertions; schedule-backed command payloads are
admitted as durable facts through the exposed `timeline` door — the exact
affordance the command-feed behaviors need; the full `engine` door remains
for submits and product fills. The stale `PipelineCommandContext.frame` uses
in the submit callback map to the current context's step facts.

Then the fix, at the seam navigation confirmed: both `encodeGroup` invocation
sites are inside `makeExecutionHost` (frameGroup at execution.ts:585, the
step path at execution.ts:615), so the least-machinery change is one optional
`onGroupSettled` callback on `makeExecutionHost`'s config, invoked in a
`finally` around each `encodeGroup`, supplied by `openEngine` as
`compiled.settleExecution`. The semantic unit is one executed moment group at
one crossing — settling only after `host.step` would let one window span a
mapped clock's multiple crossings.

## Task 2 — delete the inert system APIs

`prepareHost`, `advance`, `stepCommands`, their types (`SystemHostPrepare`
system.ts:499, siblings), config/build-output fields (system.ts:201, 248,
1583), resolution site (system.ts:1736), validation, and their tests. Nothing
replaces them — the write-only reference proof is the deletion license. This
precedes continuation work so no agent mistakes a dead API for the seam.

## Task 3 — close the replay-unsafe step controls

Extend the classification that already exists rather than inventing one:
`planExecution` refuses by source at construction; `enabled` and dispatch
need the same treatment, and the verified blocker is that `PassDeclaration`
(declaration.ts:841–873) carries no `enabled`, so the compiler cannot see
what the runtime evaluates live (compute-runtime.ts:162–167). The flow to
change is a four-step chain, each anchored: the union declared at
`SystemComputePass.enabled` (system.ts:303); lowered untouched by
`computePass` (system.ts:698) into the runtime spec; never projected by
`toPassDeclaration` (assembly.ts:1726) — the one function to extend so the
declaration states the source; refused in `planExecution` beside the
condition refusal (execution.ts:322–344), with the runtime evaluation left
where it is. Then delete the thunk `SystemDispatch` form (after
`occurrences` confirms zero active uses); promote the physics seam as
`defineScheduledCommand` — a 19-line journal filter plus the command
wrapper repeated seven times, so the promotion is extraction, not
invention.

## Task 4 — tear down the deprecated coupling

Remove `world-engine`/`world-graph` dependencies and aliases from
webgpu-engine's package.json; delete `PipelineSystem.contract` and its
construction (system.ts:153, 1799, 1922) once its only consumers go; delete
or archive open-world-v2 (its tree also holds two more tests under
`world-engine/` the handoff's list omits) and the legacy witnesses — all
five exist exactly as named at `src/`, and a sixth sibling the handoff did
not list, `physics-composed-world.typegpu.test.ts`, needs import triage
before deletion rather than assumption; add the repository check forbidding
re-imports. The world-engine references inside webgpu-engine's own project
answers are the visible symptom that closes.

## Task 5 — continuation policy, then capture/restore, then CoreTime wiring

The handoff's principal architecture, dependent on tasks 1–2. Per-resource
`ContinuationPolicy` (restore/preserve/invalidate) as a declaration fact;
`resetOwned` obeys it. Anchors now navigated: the conflation the handoff
describes is exactly one predicate — `originResources` selects every
`lifetime === "persistent"` backing (resource-runtime.ts:339–352) — so the
policy inserts at that filter and the per-kind walk below it. `resetOwned`
(353–428) already carries the disciplines a restore path needs: refuse
before the first queue mutation, clear the whole allocation before
rewriting authored initial data, async products to pending at revision 0.
Capture's raw material is present: `physicalBackings` enumerates front and
back (431–433), `products.commit` shows the front/back swap and revision
bump a checkpoint must record (443–464), and `read` is the readback
(317). Then in-memory
capture/restore with the manifest refusing incompatibility before the first
write; then the generalized continuation request on the frame-loop boundary,
whose CoreTime half (`snapshotPlan`, digest records, replay suffix) is
verified present and tested. Storage stays host-supplied; the write order is
payload-verified-before-digest-recorded.

## Task 6 — device requirements, then device loss

Acquisition is one site: `tgpu.init` at engine.ts:209–234, where required
features are requested as optional and post-checked against
`enabledFeatures` with destroy-on-missing (226–229) — so
capability-contributed requirements (union features, element-wise max
limits) merge into exactly that assembly before any backing builds, and
the application may add but not weaken. Device loss initially stops and
reports: `root.device.lost` is available immediately after acquisition,
beside the `uncapturederror` listener at engine.ts:280; recovery waits for
task 5's restoration contract, at which point it is a normal restore.

## Standing semantics to pin, not change

Phase-major step execution (execution.ts:608–627) gets a multi-clock witness
and a contract statement; the no-submit rule inside the admission gate and
per-step submission (engine.ts:486–523) are load-bearing and stay.
