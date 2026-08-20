# Tool latency, measured

Measured against `/Users/tylermitchell/Projects/kek-monorepo` — `apps/ardy` is a
1,146-file TypeScript project. The language server runs `typescript-native-bridge`
(tsgo) 6.0.3-bridge.13.tsgo.7.0.2.

Every number below is the elapsed time the tool printed in its own footer.

## Read this first: the footer measures the handler, not the call

`withElapsed` in `tool.ts` wraps the handler with `performance.now()`. It excludes
MCP transport and the model's round trip, so it is a lower bound on what a call
costs an agent, not the cost itself. A footer reading `12ms` still takes seconds
of wall time to issue and receive.

## Two measurement traps

Both of these produced wrong numbers here before they were caught.

**Repeating a byte-identical call is not a warm measurement.** Something below the
tool caches the exact query. The same `references` call reported 4,137 ms the
first time and 8 ms on immediate repeat. Only novel queries measure anything.

**The language server is single-threaded, so a cheap call queued behind an
expensive one reports the expensive one's latency as its own.**
`language-server-process.ts` states it directly: _"the server holds its only
thread and stops reading its socket, so every later call waits behind it."_ Two
tools issued in one parallel batch will both report the slower one's time. Issue
timing probes alone.

## A fresh server is not expensive

Measured immediately after `reload`, which kills and re-forks the language server.
Each call is the first of its kind against a server with nothing loaded.

| call               | what it needs                | elapsed |
| ------------------ | ---------------------------- | ------- |
| `list_files`       | filesystem only              | 18 ms   |
| `read_file`        | filesystem only              | 12 ms   |
| `project_config`   | LSP handshake, tsconfig walk | 2 ms    |
| `document_symbols` | syntactic parse of one file  | 24 ms   |
| `references`       | the type checker             | 118 ms  |

The first type-checker query against a 1,146-file project on a newly forked
server cost 118 ms. There is no expensive "cold start" to plan around.

## Editing is what costs

The large numbers — 14 s to 26 s — were all recorded after edits to files in the
project. An edit invalidates the program, and the next call needing the checker
rebuilds it. Nothing else in these measurements produced a multi-second figure
that was not either an invalidation or a queue artefact.

Teardown and refactoring are edit-heavy, so this dominates that work. Batch the
edits, then ask. Alternating edit → ask → edit → ask pays the rebuild every time.

## Warm, novel queries

Distinct symbols, each asked exactly once, on a warm project.

| call                                   | scope                                | results              | elapsed  |
| -------------------------------------- | ------------------------------------ | -------------------- | -------- |
| `references` `openTimeline`            | crossProject                         | 208                  | 240 ms   |
| `references` `Engine`                  | crossProject                         | 80                   | 1,073 ms |
| `references` `defineCommand`           | crossProject, raw                    | 155                  | 245 ms   |
| `references` `makeTimelineFrameLoop`   | crossProject                         | 3                    | 46 ms    |
| `references` `frameLease`              | project                              | 4                    | 13 ms    |
| `references` `reconcileMotionProgram`  | project                              | 3                    | 4,137 ms |
| `inspect_symbol` `defineCommand`       | crossProject, limit 100              | 155                  | 405 ms   |
| `inspect_symbol` `makeStageRun`        | source, type defs, uncompacted calls | 868-line body        | 391 ms   |
| `explore_symbol` `openEngine`          | limit 100, related 20                | 87 refs + 20 similar | 1,706 ms |
| `callees` `openMotionRuntime`          | 917-line body                        | 30 targets           | 43 ms    |
| `document_symbols` `render-runtime.ts` | raw                                  | ~400 nested          | 35 ms    |

Result count does not predict cost: 208 references took 240 ms while 80 took
1,073 ms, and a 3-result query took 4,137 ms.

## The one intrinsic worst case: type instantiation

`hover` on a deeply-inferred generic — an arktype schema — is the only subtool
with a cost that is not explained by invalidation or queueing.

| call                                                           | elapsed  |
| -------------------------------------------------------------- | -------- |
| `hover` `MotionAgentNode` (arktype, first instantiation)       | 3,512 ms |
| `hover` `MotionAgentNode` (repeat)                             | 11 ms    |
| `hover` `MOTION_SCENARIOS` (different file, immediately after) | 9 ms     |

The third row is the mechanism: instantiating the first schema warmed the shared
type the second depends on. This is a distinct cache from the program — it was
paid on an already-built project.

`inspect_symbol` always calls `hover`, so this sets the floor for the compound
tool: 7,282 ms on its first touch of such a symbol, 127 ms after.

## Whole-project diagnostics

`diagnostics` with `scope: "project"` on `apps/ardy` reported 25,988 ms after
edits and SIGABRT'd under memory pressure four times in one session. It is the
only call observed to kill the server. File-scoped diagnostics
(`includeDiagnostics` on any file tool) are unaffected and cost milliseconds.

## Method

To measure anything here again:

1. `reload` to establish a known server state.
2. Issue the probe **alone** — never in a parallel batch.
3. Use a symbol or position never queried in this session.
4. Do not edit between the warm-up and the measurement.
5. Read the footer as a handler lower bound, not a call cost.
