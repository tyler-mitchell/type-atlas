# TypeScript Code Intelligence for Agents — Field Comparison

> MCP servers that give coding agents semantic understanding of **TypeScript
> codebases**, compared on how they behave in a **monorepo**.
>
> Every cell is verified from source or by running the tool. Where Type Atlas
> loses, it says so — and it loses more often than a vendor comparison would
> admit.

## Why this peer set

Polyglot agent toolkits like Serena are excluded: breadth across ~60 languages,
project memory, and onboarding solve a different problem, and measuring a
TypeScript navigator against them measures the wrong thing.

Everything here answers one question: _given a TypeScript repository, what can an
agent learn about a symbol without reading files?_

**The monorepo is the axis that separates them.** Any of these can hover a symbol
in a single package. Multiple `tsconfig.json` files, workspace packages resolving
to each other's build output, and references crossing a project boundary are
where designs diverge — and where most quietly return incomplete answers.

## The category is unmarketed

| Stars | Project                                   | Note                                              |
| ----: | ----------------------------------------- | ------------------------------------------------- |
|   452 | `mizchi/lsmcp`                            | Renamed from `typescript-mcp`; no longer ts-morph |
|    67 | `alperhankendi/Ctxo`                      | Dependency graphs, blast radius, git intent       |
|    16 | `SiroSuzume/mcp-ts-morph`                 | Best-tested project in the set                    |
|    10 | `JSungMin/vs-token-safer`                 | Gates its own token savings in CI                 |
|     3 | `jgauffin/ts-language-mcp`                | 24 tools, ~3,900 npm downloads/month              |
|     3 | `jaenster/ts-lsp-mcp`                     | Real per-tsconfig project isolation               |
|     0 | `ricleedo/typescript-static-analysis-mcp` | Read-only, closest scope match                    |

Stars measure marketing, not engineering. The 16-star project has 37 test files,
e2e tests, and three CI workflows. The 452-star project has not been pushed since
2025-10-27. A 3-star project has 3,900 monthly npm downloads. Nobody has
consolidated the category, and most authors appear unaware of each other.

## Legend

| Mark | Meaning               |
| :--: | --------------------- |
|  ✅  | Verified present      |
|  ⚠️  | Present with a caveat |
|  ❌  | Verified absent       |
|  ?   | Not yet verified      |

Columns: **TA** Type Atlas · **TLM** `ts-language-mcp` · **TLS** `ts-lsp-mcp`
(jaenster) · **LSM** `lsmcp` · **TSM** `mcp-ts-morph`

---

## 1. Monorepo behaviour

|                                        | TA  | TLM | TLS | LSM | TSM |
| -------------------------------------- | :-: | :-: | :-: | :-: | :-: |
| Handles multiple `tsconfig.json`       | ✅  | ❌  | ✅  | ❌  | ❌  |
| One program per project                | ✅  | ❌  | ✅  | ❌  | ❌  |
| **States which project answered**      | ✅  | ❌  | ❌  | ❌  | ❌  |
| Symbol lookup crosses packages         | ✅  | ❌  | ❌  | ⚠️  | ❌  |
| References cross packages              | ❌  | ❌  | ❌  | ⚠️  | ❌  |
| Excludes generated `dist` declarations | ✅  | ❌  | ❌  | ❌  | ❌  |

**Nobody in this category resolves references across packages.** Not one. That is
the headline finding, and Type Atlas does not solve it either.

- **`ts-language-mcp`** reads only `path.join(projectRoot, 'tsconfig.json')`, and
  its own docstring says so: _"Only checks the project root directory — does NOT
  walk up to parent directories"_ (`src/language-service.ts:75-103`). No project
  references handling anywhere. On a solution-style root whose tsconfig has only
  `references`, it falls back to walking the entire tree into one program with
  default compiler options (`src/file-manager.ts:21-55`).
- **`ts-lsp-mcp` gets the primitive right and stops there.** `ProjectManager`
  keeps a `Map<tsconfigPath, ProjectContext>` with one real `ts.Program` per
  tsconfig, discovered by walking up from the queried file
  (`src/typescript/project-manager.ts:21-95`) — architecturally the correct
  model, and the closest thing to Type Atlas here. But `findAllTsConfigs()`
  exists and is **never called by any tool**, `listProjects()` is never wired to
  the server, no response carries which tsconfig answered, and `getReferences`
  runs against the querying package's program only. Its README claims monorepo
  support; per-package hover and diagnostics deliver, cross-package references do
  not.
- **`mcp-ts-morph`** requires the caller to pass one `tsconfigPath` string on all
  8 tools (`_utils/ts-morph-project.ts:6-14`), and its source documents the
  fallout: `collectPackageExportWarnings` warns that imports from sibling
  packages resolve to built output and are invisible, so exports get "reported
  unused even when consumed."
- **`lsmcp`** parses no tsconfig at all — one language server rooted at
  `process.cwd()` (`src/lspServerRunner.ts:43,66,93`), all project decisions
  outsourced to tsserver.

**Type Atlas, run live** on this three-package pnpm workspace:

```
packages/core/src/operations.ts          → packages/core/tsconfig.json
packages/mcp/src/server.ts               → packages/mcp/tsconfig.json
packages/language-server/src/server.ts   → packages/language-server/tsconfig.json
```

Symbol lookup crosses into another package's **source**, not its build output:

```
Scope: loaded projects · anchor packages/mcp/tsconfig.json
createTypeAtlas [variable] packages/core/src/operations.ts:66:14-194:3
```

References do not cross, and say so:

```
Scope: project only · packages/core/tsconfig.json
```

Ground truth here is 17 references across 6 files; a project-scoped answer
returns 3. **Type Atlas has the same gap as everyone else. Its one unique
property is telling you.** Across all six peers, no other tool reports the
provenance of an answer.

---

## 2. Engine and warm state

|                             |   TA    |    TLM     |    TLS     | LSM |   TSM    |
| --------------------------- | :-----: | :--------: | :--------: | :-: | :------: |
| Engine                      |  Volar  |   TS API   |   TS API   | LSP | ts-morph |
| Warm between calls          |   ✅    |     ✅     |     ✅     | ✅  |    ❌    |
| Rebuilds per call           |   ❌    |     ❌     |     ❌     | ❌  |    ⚠️    |
| File-change detection       | watcher | mtime poll | mtime poll | LSP |   n/a    |
| One process, TS + MD + JSON |   ✅    |     ❌     |     ❌     | ❌  |    ❌    |

**Per-call reconstruction** is the worst pattern here, and two projects have it.
`mcp-ts-morph` calls `initializeProject(tsconfigPath)` as the first line of every
handler — a full tsconfig parse and type-checker build per invocation.
`typescript-static-analysis-mcp` is worse: it rebuilds at six call sites and
ships a `CacheManager` with LRU caches (`src/cache.ts:704-737`) that is **never
wired into any handler** — dead code.

Both compiler-API projects poll `mtime` to detect changes; `ts-language-mcp`
re-walks the whole tree on every diagnostics call, throttled to once per 2 s
otherwise. Type Atlas uses a filesystem watcher instead.

Type Atlas measured: warm **~20 ms**, cold **~1.8 s**, 30-minute idle window.

---

## 3. Output economics

Same question — _what is in this file?_ — same 286-line file, same engine class.

| Answer produced by                  |   chars | ≈tokens |
| ----------------------------------- | ------: | ------: |
| Raw LSP JSON, pass-through          |  31,584 |  ~7,896 |
| The file itself, read whole         |  11,038 |  ~2,760 |
| A formatted symbol tree (139 nodes) |  ~4,900 |  ~1,225 |
| **Type Atlas `document_symbols`**   | **271** | **~68** |

The raw response is **2.9× larger than the source file it describes**: 139 symbol
nodes, of which 3 are real declarations and 136 are nested properties and
anonymous callbacks.

|                            |   TA    |     TLM      |      TLS      |   LSM   |     TSM     |
| -------------------------- | :-----: | :----------: | :-----------: | :-----: | :---------: |
| Folds bodies to signatures |   ✅    |      ❌      | ⚠️ types only |   ❌    |     ❌      |
| Compact serialization      | ✅ text |   ✅ YAML    |    ❌ JSON    | ✅ text |   ✅ text   |
| Diagnostics bounded        |   ✅    |  ✅ 50/500   | ❌ unbounded  |   ❌    |      —      |
| References bounded         |   ✅    |      ❌      |     ✅ 50     |   ❌    | ⚠️ one tool |
| Line-ranged reads          |   ✅    |      ❌      |      ❌       |   ❌    |     ❌      |
| Batch files per call       |   ✅    | ⚠️ positions |      ❌       |   ❌    |     ❌      |
| **Gates savings in CI**    |   ❌    |      ❌      |      ❌       |   ❌    |     ❌      |

Two competitors deserve credit here.

**`ts-language-mcp` hand-rolled a YAML serializer** (`src/yaml.ts:16-52`) used for
every tool except two, explicitly to avoid JSON's braces and quotes. That is a
real, deliberate token strategy, and it caps diagnostics at 50 by default and 500
maximum.

**`vs-token-safer` is ahead of everyone on rigour, including Type Atlas.** Its CI
gate (`eval/run.mjs`) asserts **≥70% token reduction versus the raw index** and
reports 97.4% — `~57,308 → ~1,515 tokens` on a 1,000-symbol response. Its
formatter emits `kind name (in container) @ file:line` and "**never** ranges,
kinds, or source", with a `… N more` footer.

Type Atlas has better numbers on the case measured above but **asserts** them in
a document where `vs-token-safer` **gates** them on every commit. A regression
that started leaking bodies would fail their build and pass ours. That is a gap
worth closing.

---

## 4. Composition — calls per question

|                                          | TA  | TLM | TLS | LSM | TSM |
| ---------------------------------------- | :-: | :-: | :-: | :-: | :-: |
| One call for the symbol picture          | ✅  | ✅  | ❌  | ❌  | ❌  |
| Batch across many positions              | ❌  | ✅  | ❌  | ❌  | ❌  |
| References de-duplicated against callers | ✅  | ❌  | ❌  | ❌  | ❌  |

**Composition is not a Type Atlas invention.** `ts-language-mcp`'s
`analyze_position` bundles hover, definition, references, diagnostics, and
signature in one call (`src/language-service.ts:488-500`), and `batch_analyze`
runs that across an array of positions — a batching axis Type Atlas does not
have.

What remains distinctive is the _shape_: `inspect_symbol` composes eight
requests and reports references as the **residual** after callers and definitions
are accounted for, so the agent sees each location categorised by why it exists
rather than as one flat list. Measured: **7,540 → 1,861 characters, 7 calls → 1**.

---

## 5. Correctness and safety

|                               | TA  |       TLM        | TLS | LSM |    TSM    |
| ----------------------------- | :-: | :--------------: | :-: | :-: | :-------: |
| Diagnostics attached unasked  | ✅  | ⚠️ composed only | ❌  | ❌  |    ❌     |
| Edits returned as patches     | ✅  |        ❌        |  —  | ❌  |    ❌     |
| Never writes to disk          | ✅  |        ✅        | ✅  | ❌  | ⚠️ opt-in |
| Guidance in the MCP handshake | ✅  |        ❌        | ❌  |  ?  |    ❌     |

Write safety splits the field sharply. **`lsmcp` calls `writeFileSync` directly**
during rename (`rename.ts:297,328`) with **no dry-run parameter in its schema**.
`mcp-ts-morph` saves by default, with `dryRun` opt-in defaulting to false.

`ts-language-mcp` never touches disk — but not by returning patches: it mutates
an in-memory file map and expects the agent to re-read a resource URI to see the
result, which is a different and arguably more surprising contract.

Type Atlas returns every edit as a patch:

```
Organize Imports · 1 file · 11 edits

*** Begin Patch
*** Update File: packages/mcp/src/navigation.tools.ts
@@
+import type { McpServer } from "@modelcontextprotocol/server";
...
```

Diagnostics arrive with purely structural questions:

```
Symbols (2 top-level) · src/example.ts
wrong [variable] selection 1:14-1:19; body 1:14-1:40

Diagnostics: 1 error · src/example.ts
error ts(2322) 1:14-1:19
  Type 'string' is not assignable to type 'number'.
```

`ts-language-mcp` embeds diagnostics too, but only inside its composed
`analyze_position`/`batch_analyze` calls — ask it for symbols alone and you get
no errors.

---

## Three more worth reading, and what they get right

These sit slightly outside the five-column tables — one is an analysis layer
rather than a navigator, one spans many languages, one is deliberately
single-root — but each contains an idea worth taking seriously.

### `Ctxo` (67★) — the best output-budget mechanism in the category

Not a navigator. Fourteen tools answering _impact_ questions: `get_blast_radius`,
`get_why_context`, `get_change_intelligence`, `get_pr_impact`,
`get_ranked_context` (`packages/cli/src/index.ts:124-368`). It runs over a
persisted SQLite index built by a separate CLI, not a warm parser, and detects
staleness by mtime then **warns** rather than rebuilding.

Its monorepo story is weaker than its reputation:
`single-package-workspace.ts:38-51` says plainly _"v0.7 implementation: always
returns a single-package workspace"_, and its ts-morph adapter never reads a
`tsconfig.json` at all — hardcoded ES2022 options over an in-memory filesystem.
Workspace members are discovered at index time only, for globbing, then flattened
into one undifferentiated symbol graph.

But its response envelope is the best engineering in this document.
`wrapResponse` (`core/response-envelope.ts:117-204`) sets an 8 KB budget, finds
the largest truncatable array, and **binary-searches** the maximum length whose
re-serialized JSON fits. Every response carries
`_meta: { totalItems, returnedItems, truncated, totalBytes, hint }` — and `hint`
names the narrower tool to call instead: _"Use search_symbols to find specific
impacted symbols, or get_blast_radius with a confidence filter."_

That is strictly better than Type Atlas's fixed formatting. We truncate to a
constant; they fit a budget and tell the agent how to ask better.

### `vs-token-safer` (10★) — measures itself, and solves our schema problem

Real spawned `typescript-language-server`, with a client pool keyed by
backend and root, 5-minute idle reap, LRU eviction that refuses to evict a client
with an in-flight request, **boot-time prewarm**, and a warm-set ranked by query
history, git status, and include-graph centrality (`server/warmset.js:1-14`).

Two things it does that Type Atlas does not:

**It folds 12 admin operations behind one `vts_admin` multiplexer**, with a source
comment saying this was done explicitly _"to cut the fixed per-session
tool-definition cost"_ (`server/tools.js:260-263`). That is the exact problem
measured for Type Atlas — ~15,400 tokens of schema — recognised and addressed by
a 10-star project.

**It keeps an honest savings ledger.** `recordSavings` (`core.js:299-326`)
persists raw and output token totals per tool to disk, **floors negative deltas
rather than hiding them**, and carries a source comment admitting the dogfooding
result: _"search_text/find_files went slightly negative"_. The user-facing savings
line is gated to responses above 2,000 tokens so it cannot claim credit on
trivial ones.

It also ships a Claude Code `PreToolUse` hook that intercepts `Bash`/`Grep`/`Glob`
calls and steers them to its own CLI — structural interception an MCP server
cannot do alone.

### `trophygeek/ts-lsp-mcp` (1★) — two ideas worth copying outright

Nine tools over the **TypeScript 7 native server** (`tsc --lsp --stdio`, falling
back to `tsgo`), with an explicit version gate rejecting TS ≤ 6
(`src/config.ts:78-160`). No side database: _"There is no side database to build,
warm, or invalidate"_, and documents are re-read from disk before every request.
Explicitly single-root — _"run multiple instances for multiple projects"_ — so it
does not attempt the monorepo at all.

Two ideas stand out despite one star and no test suite:

1. **Misposition detection.** A positional query echoes the identifier actually
   found at that line and column (`resolve.ts:74-81`). An off-by-one guess
   becomes visibly wrong instead of silently answering about the wrong symbol.
   Type Atlas has no equivalent — a wrong position quietly returns "no symbol",
   which happened twice while gathering measurements for this document.
2. **Distribution before detail.** `ts_references` leads with a per-file tally
   (`fileTally`, lines 49-65) — `file ×N`, capped at 15 files — before showing any
   individual location. The agent learns the shape of the answer before spending
   tokens on its contents.

## Ideas worth stealing

Ranked by value to Type Atlas, all verified in source above:

| Idea                                                           | From           | Why it matters here                                                               |
| -------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| Budget-fitting truncation with a `hint` naming a narrower tool | Ctxo           | Replaces fixed limits with an actual byte budget, and teaches the agent to re-ask |
| Multiplexing rarely-used tools behind one entry                | vs-token-safer | Directly attacks our ~15,400-token schema weight                                  |
| CI gate on token reduction                                     | vs-token-safer | Turns our asserted numbers into enforced ones                                     |
| Persisted savings ledger that floors negative deltas           | vs-token-safer | Honest self-measurement, including where we lose                                  |
| Misposition echo                                               | trophygeek     | Cheap fix for silent wrong-position answers                                       |
| Per-file tally before reference details                        | trophygeek     | Shape before contents                                                             |
| Co-change-boosted impact analysis                              | Ctxo           | Git history answers "what else breaks" that no LSP can                            |

## What is actually unique to Type Atlas

After six source-verified comparisons, the list is short and worth stating
precisely:

1. **Answer provenance.** No other tool reports which TypeScript project produced
   a result. Given that none of them resolve cross-package references either,
   they all return scoped answers that read as complete.
2. **One process for TypeScript, Markdown, and JSON.** A consequence of Volar's
   composition model; every peer is TypeScript-only.
3. **Structural folding of file reads.** `vs-token-safer` folds symbol lists;
   nobody else folds function bodies in a file read.
4. **Patches as the editing contract.** Two peers write to disk; one mutates
   memory; none return a reviewable patch.

Everything else — composition, warm programs, bounded output, compact
serialization, read-only safety — has at least one peer doing it, and sometimes
doing it better.

## Where Type Atlas loses

- **Cross-package references.** 3 of 17. Disclosed, unsolved.
- **No CI gate on token claims**, where `vs-token-safer` has one.
- **No batch-across-positions**, where `ts-language-mcp` has one.
- **No exact text search.** Retrieval matches meaning, not strings.
- **~15,400 tokens of tool schema** before any work.
- **Three file types**, not sixty.
- **Adoption.** `ts-language-mcp` has ~3,900 monthly npm downloads; Type Atlas
  published its first real release on 2026-08-08.

## Verification status

| Target                  | Basis                                                    | State    |
| ----------------------- | -------------------------------------------------------- | -------- |
| Type Atlas              | Run live, reproduced 2026-08-08                          | Verified |
| `ts-language-mcp`       | Source: 24 tools, single tsconfig, YAML, in-memory edits | Verified |
| `ts-lsp-mcp` (jaenster) | Source: ProjectManager map, dead `findAllTsConfigs`      | Verified |
| `lsmcp` (mizchi)        | Source: single LSP root, `writeFileSync` rename          | Verified |
| `mcp-ts-morph`          | Source: per-call Project, cross-package warning          | Verified |
| `ts-static-analysis`    | Source: dead cache, 50-file cap                          | Verified |
| `vs-token-safer`        | Benchmark and CI eval gate read directly                 | Partial  |
| `Ctxo`                  | Investigation in progress                                | Pending  |

No competitor was run live; their cells come from reading source, ours from
execution. That asymmetry favours us and is the largest methodological weakness
here.

Broader comparison including polyglot tools and generic LSP bridges:
[code-intelligence-mcp-comparison.md](code-intelligence-mcp-comparison.md).
