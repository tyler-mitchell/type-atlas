# kek-monorepo latency invariant

Every tool call issued against `/Users/tylermitchell/Projects/kek-monorepo` answers in
**under 2 seconds**. A call above that is a defect in this repository, not a property of
the target repository. This file records each violation as the exact call that produced
it, so a fix can be re-run against the same input.

kek-monorepo is the reference workload because it is a real monorepo: 24 packages, an app
whose TypeScript program is 1,076 files, and a package (`webgpu-engine`) exporting 1,999
symbols.

## How to re-run a sample

Every row is a literal tool input. Issue it verbatim and read the `· NNNms` footer. State
whether the server was cold (first semantic call after a start) or warm, because a cold
call additionally pays fork, LSP handshake, watcher registration, and one project build.

One caveat about the instrument, since every number in this file comes from it. Request
traces accumulate in a module-global that used to be drained only when a call *returned*,
so a call that threw, timed out, or died with the server left its traces behind to be
billed to whatever ran next: a 589 ms answer reported `4 language-server requests ·
25.98s · slowest type-atlas/projectDiagnostics 8.68s`, nearly all of it belonging to three
aborted calls before it. The buffer is drained on entry now, so a footer describes only
its own call — but any measurement in this file taken shortly after a crash or a timeout
was inflated by that leak and is worth re-taking before it is trusted.

Baseline, for scale — these are already inside budget:

| call | input | measured |
| --- | --- | --- |
| `read_file` | any path in kek | 2–5 ms |
| `list_files` | `directory: "packages"` | 9–60 ms |
| `document_symbols` | `apps/ardy/src/application/runtime/index.ts` | 34 ms |
| `project_config` | `packages/core-time/src/index.ts` | 246 ms |
| `references` | violation 1's input, second request into that file | 24 ms |

## Correctness, found while measuring

Several tools reported nothing for questions that have answers. The shared signature is a
request returning in single-digit milliseconds without searching — an unimplemented
language-service API whose throw `volar-service-typescript` turns into `[]` in `safeCall`
(`lib/plugins/semantic.js:473-476`), so a service that cannot answer looks exactly like one
with nothing to report. Every affected API is a reverse lookup. The forward
directions — definitions, hover, outgoing calls, references, diagnostics — answer normally
throughout.

| tool | symptom | now |
| --- | --- | --- |
| `callers` | `no callers` in 5 ms for symbols with verified call sites | derived, 9 callers in 133 ms |
| `document_highlights` | `0` in 14 ms for a const used twice in one file | derived, answers |
| `file_references` | `0` in both repositories, for modules with importers | derived, 27 here / 15 in kek |
| `workspace_symbols` | `0` in 6 ms for `createTypeAtlas`, a name that exists | still unanswered, labelled |

The three repaired ones are assembled from primitives that do answer, and each deleted the
request it replaced rather than wrapping it:

- **Incoming calls** are references whose enclosing callable is not the symbol itself.
  `incomingCalls` in `symbol-inspection.ts` serves both `callers` and `inspect_symbol`.
- **Document highlights** are that same reference search kept to the file it was asked
  about. Read and write kinds are not reported, because the request distinguishing them is
  the one that does not answer.
- **File references** are references to what a module declares, so a module imported only
  for its side effects reports none.

`implementations` is a reverse lookup and was never checked against this family, which is
a gap in the table above rather than a result. It cannot be settled in either repository
to hand: a `satisfies` clause in `packages/language-server` and a position in
`kek-monorepo/packages/utils` both report nothing, and neither repository declares a class
or an implemented interface for the answer to be non-empty. What the two calls do show is
that it lacks the family's signature — 771 ms and 717 ms, against the 5–14 ms that
`callers`, `workspace_symbols`, and `document_highlights` returned while not searching at
all. That is consistent with a request doing real work and finding nothing, and it is not
proof. Settling it needs a repository with an interface something implements.

`workspace_symbols` is the one left. A name search across projects is not cheaply derivable
— it means scanning every document's outline — so its absence says it is unanswered rather
than empty, and names `document_symbols` and `search_code`, which both work.

Superseded: this section previously cited `search_dependency_code` failing on the
`typescript` package with `project not found for update: …/jsconfig.json` as the witness
that tsgo fails operations. That call now answers in 321 ms with real results. The
underlying claim held anyway — the reverse-lookup APIs above are the direct evidence — but
the cited symptom is gone, and a prohibition that outlives its defect is worth re-measuring
rather than inheriting.

### A document no TypeScript project owns ends the language server

A semantic request against a non-TypeScript document exits the server with code 1. It
restarts on the next call and TypeScript is unaffected, so the damage is one killed request
plus a cold program build for whatever asks next.

| call | file | result |
| --- | --- | --- |
| `document_symbols` | `docs/kek-monorepo-latency.md` | exit 1 |
| `document_symbols` | `docs/tool-latency-measurements.md` | exit 1 |
| `document_links` | `docs/kek-monorepo-latency.md` | exit 1 |
| `document_links` | `README.md`, this repo | exit 1 |
| `document_links` | `README.md`, kek-monorepo | exit 1 |
| `document_symbols` | `packages/core/package.json` | exit 1 |
| `hover` | `README.md`, this repo | exit 1 |
| `document_symbols` | `.claude/hooks/type-atlas-usage-loop.mts` | exit 1 |
| `document_symbols` | any `.ts` file inside a tsconfig | answers normally |

Three request types, so it is not one handler. And the last two rows are the decisive pair:
a **TypeScript** file outside every tsconfig crashes exactly like the Markdown ones, while a
TypeScript file inside one is fine. The language is not the variable — being unowned by a
project is. Markdown and JSON are simply never covered by a tsconfig, so they fail every
time; a stray `.mts`, a script, or a file excluded from `include` fails the same way.

Both workspaces, so it is not one project's configuration. Two of the three languages this
package advertises are unreachable through these tools — not because their services are
broken, but because no tsconfig ever covers their files.

Ruled out by measurement:

- **A missing language id for `.json`.** `getLanguageId` mapped `jsonc` and the Markdown
  extensions and returned `undefined` for everything else, so plain `.json` resolved to no
  language at all. That was a real gap and is fixed — the mapping is now a lookup table
  carrying `json` — but `document_symbols` on `packages/core/package.json` still exits the
  server, so it was not the cause.

Not yet traced. Where to start, from the registration itself:

`server.ts` builds the project with `createTypeScriptProject(projectTypeScript, undefined,
() => ({ languagePlugins: [documentLanguagePlugin] }))`, so **every** document resolves
through a TypeScript project. `documentLanguagePlugin` declares only `getLanguageId` — no
`createVirtualCode`, no `typescript` mapping. A `.md` or `.json` file therefore receives a
language id and is then handed to a project that has no way to make a script of it. Both
services are registered correctly (`createJsonService()` and `createMarkdownService({
fileExtensions })`), which fits the evidence: the failure is in resolving a project for the
document, before either service is consulted, and that is why both languages fail
identically while TypeScript is unaffected.

Consistent with this, a `textDocument/documentLink` issued inside `search_code` answered in
5,828 ms without crashing — that path does not resolve a project per document the way the
tools do.

The mechanism, from Volar's own source. `@volar/language-server/lib/project/typescriptProject.js`
declares `rootTsConfigNames = ['tsconfig.json', 'jsconfig.json']` and keeps `configProjects`
beside `inferredProjects`: a document matching no root config falls back to an **inferred**
project. Markdown and JSON files belong to no tsconfig, so every one of them takes that
path, and TypeScript files never do.

That is the same path named in the tsgo error this file recorded earlier — `api: client
error: failed to update snapshot: project not found for update:
/users/tylermitchell/projects/featuretype/jsconfig.json`, a lowercased path to a
`jsconfig.json` that does not exist. The bridge fails on inferred projects, and here that
failure ends the process rather than returning an error. One symptom, one cause, and it
explains why two unrelated language services fail identically.

The affordance to reach for is already imported by that same Volar file: `simpleProject`
(`./simpleProject`), whose `createSimpleProject(languagePlugins)` returns the same
`LanguageServerProject` that `createTypeScriptProject` does and resolves a document's
language from `server.documents.get(uri)?.languageId`, with no TypeScript project involved.

Cost to know before starting: `createSimpleProject` is **not** on the package's public
export surface — `search_dependency_code` reports no exported name matching it, and only the
source search finds it — so reaching it means a deep import into
`@volar/language-server/lib/project/simpleProject.js`, or serving non-TypeScript documents
some other way. The decision to revisit is that every document currently goes through
`createTypeScriptProject`; verify against Volar's own consumers before changing it.

## Violations

### 1 · first semantic request into `apps/ardy/src/application/runtime/index.ts` — 3,231 ms

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "file": "apps/ardy/src/application/runtime/index.ts",
  "position": { "line": 88, "character": 14 },
  "includeDiagnostics": "off",
  "limit": 20
}
```

Measured with ardy's program already built through a different file, so no project build
is inside these numbers:

| request into that file | first | second |
| --- | --- | --- |
| `references` at 88:14, project scope | 3,231 ms | 24 ms |
| `references` at 88:14, workspace scope (now the default) | 3,296 ms | 19 ms |
| `hover` at 88:14 | 3,106 ms | — |

Workspace scope is the default since references became scope-aware, and it costs
essentially nothing here: the fan-out asks each loaded service and merges, and the
arktype instantiation below dominates both. Measured against the same input at project
scope, 3,296 ms against 3,231 ms, with identical results.

`hover` is one round trip with no reference search and costs the same. The identical
`references` call into `apps/ardy/src/components/motion-agent-controls.tsx`, also a first
touch, also exported, in the same program, answers in **58 ms**.

So this is not the reference search, not the tool surface, and not the program's 1,076
files. It is TypeScript checking this one file — a 917-line `openMotionRuntime` whose
signature is arktype `typeof … .infer` chains — and the first semantic request of any kind
pays it. `textDocument/diagnostic` on the same file costs 6,933 ms for the same reason.

This row therefore records a property of the target repository, which the invariant above
says cannot happen. The invariant is wrong as stated: a first touch of an expensive file is
not a defect here, and no change in this repository removes it without either caching an
answer that can go stale, hiding the cost behind an earlier call, or searching less than was
asked. Steady state for the same call is 24 ms.

Superseded cause: this row previously blamed `connection.onReferences` fanning out across
every loaded language service under `crossProject`. That branch never executed — it was
registered inside `connection.onInitialized`, after `server.initialize()` had installed
Volar's own handler — so Volar answered every reference request. With both projects loaded,
`crossProject` changed neither results nor timing in either direction: 3,444 ms against
3,570 ms from ardy, 124 ms against 30 ms from core-time. It has since been removed.

Ruled out by measurement, so nobody spends the cycle again:

- **Program size.** `references` on `motion-agent-controls.tsx`, exported, same 1,076-file
  program, first touch: 58 ms.
- **Whole-file type-check.** `hover` on the xstate import at 4:10 in the same file, first
  touch of that file: 71 ms, against 3,106 ms at 88:14. Only the queried symbol's type is
  instantiated.
- **Per-request invalidation / watcher churn.** Warm `definitions` at the same position:
  46 ms.
- **The Effect language-service decoration.** `effect-language-service.ts` returns the plain
  language service when a project configures no plugin, and ardy configures none.
- **A missing native checker.** The `typescript-native-bridge` override is applied in
  `pnpm-workspace.yaml`; ardy's program builds in about 1,030 ms.
- **`findReferences` building discarded definition display parts.** `semantic.js:575` does
  call `findReferences` and keeps only document spans, so the display parts are genuinely
  thrown away — but swapping the plugin's `provideReferences` to `getReferencesAtPosition`
  measured 3,428 ms against 3,231 ms with identical results. Both APIs share TypeScript's
  core search, and that search has to check the candidate sites: typing
  `openMotionRuntime({ … })` in `app.tsx` instantiates the same arktype signature hover
  does. The override was reverted rather than kept.

### 2 · `hover`, first semantic call after a server start — 3,557 ms

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "file": "apps/ardy/src/application/runtime/index.ts",
  "position": { "line": 88, "character": 14 },
  "includeDiagnostics": "off"
}
```

Not the cold path. Re-measured with the program already built through
`apps/ardy/src/components/motion-agent-controls.tsx`, this same call still costs 3,106 ms,
and that cheap file's own first touch costs 58 ms. It is the same finding as row 1: the
first semantic request into `application/runtime/index.ts` pays that file's type-check.
The fork, handshake, and program build together are about 1,030 ms.

### 3 · `diagnostics` over a named project — server abort, no answer

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "project": "packages/core-time",
  "scope": "project",
  "limit": 2
}
```

Reproduced three times, including on a freshly started server with only this project
loaded, so it is not cumulative pressure from other projects. `project_config` on
`packages/core-time/src/index.ts` answers in 246 ms, so the project itself is cheap.

The abort is the heap. V8 aborts when it cannot grow the old space and Node reports that
as `SIGABRT`, which is what this call produces — reproducibly, four times, including on a
freshly started server with only this project loaded. The message now says so and says
that repeating will not help, because repeating is what the previous message advised and
it sends an agent around a loop that cannot terminate.

Superseded cause: this row previously blamed `projectDiagnostics` in `server.ts` for
materialising every diagnostic in the program into one array and then appending per file
with `[...(byFile.get(uri) ?? []), converted]` — quadratic in one file's count. Both were
real and both are fixed: the walk is per file and appends in place. **The call still
aborts identically**, so that was never the cause. Fixing it changed nothing measurable
here, and the next agent should not spend the cycle again.

What the evidence points at instead is the type-checking itself. `packages/utils`, whose
program is a single file, answers in 593 ms. `packages/core-time` is 60+ files of arktype
declarations — the same construct row 1 records costing 3,231 ms to check for one
917-line signature — and checking all of them at once exceeds a heap already raised to
half of total memory. 774 diagnostics is nothing to hold; the types behind them are not.

### 4 · `diagnostics` over `apps/ardy` — 29,009 ms

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "project": "apps/ardy",
  "scope": "project",
  "limit": 6
}
```

Same cause as row 3 — the program's type-check, not the report's assembly. Re-measured
at 23.9 s, of which 23.4 s is the single `projectDiagnostics` request: 1,177 problems in
230 files, 1,146 files checked. It completes rather than aborting, so it is the gentler
face of the same limit, and the 29,009 ms figure predates the per-file walk.

Worth knowing before optimising it: 774 of the 1,177 are one code — `typescript(5097)`,
an `allowImportingTsExtensions` setting — so two thirds of this cost is one line of
configuration in the target repository rather than anything a check could avoid doing.

### 5 · `list_module_exports` with details — 18,480 ms

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "fromFile": "apps/ardy/src/application/runtime/index.ts",
  "module": "webgpu-engine",
  "query": "frame loop clock time step driver",
  "limit": 25
}
```

`includeDetails` defaults on, so every item on the page costs a `completionItem/resolve`
round trip, and the declaration-location pass adds one `textDocument/definition` per item.
The same call with `includeDetails: false` answers in 1,864 ms.

### 6 · `search_dependency_code` — 23,005 ms (failing) / 16,097 ms (succeeding)

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "file": "apps/ardy/src/application/runtime/index.ts",
  "package": ["webgpu-engine"],
  "query": "timeline clock capability",
  "limit": 3,
  "snippetLines": 12
}
```

Two semantic-index searches plus two `listModuleExports` passes, one of them over 500
labels.

### 7 · `inspect_symbol` by name, symbol absent from the named file — 19,467 ms

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "symbol": "createTimelineClockCapability",
  "file": "packages/webgpu-engine/src/index.ts",
  "includeSource": true,
  "limit": 25
}
```

Spends the entire budget to answer "not found" for a name the file re-exports.

### 8 · `callers` — 19,679 ms

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "file": "apps/ardy/src/application/runtime/system.ts",
  "position": { "line": 31, "character": 14 },
  "includeDiagnostics": "summary"
}
```

11,009 ms of that was the ambient diagnostic rider, which is now cached per file until the
workspace changes; the remainder is the call-hierarchy request itself.

### 9 · `workspace_symbols` — no longer a latency row

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "file": "apps/ardy/src/application/runtime/index.ts",
  "query": "PipelineRuntime"
}
```

This recorded 9,178 ms. The tool now returns nothing in single-digit milliseconds, for any
query, including names that exist — the navigate-to API is one of the unanswered reverse
lookups above. It is a correctness row, not a latency one, and the 9,178 ms measurement no
longer describes anything reachable.

### 10 · `investigate_code` — 16,019 ms

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "directory": "apps/ardy/src",
  "question": "what advances the frame loop and supplies deltaSeconds to the motion runtime",
  "snippetLines": 8,
  "candidateLimit": 3
}
```

### 11 · `search_code` — 3,187 to 7,138 ms

```json
{
  "workspace": "/Users/tylermitchell/Projects/kek-monorepo",
  "directory": "apps/ardy/src",
  "query": "reading the wall clock directly during a frame",
  "limit": 2,
  "snippetLines": 5
}
```

Warm searches over an already-built index cost tens of milliseconds elsewhere, so this is
the enrichment pass rather than retrieval.
