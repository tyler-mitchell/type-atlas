# Code Intelligence MCP Comparison

## Objective

Establish what, specifically, makes Type Atlas compelling relative to the other
ways an agent can obtain code intelligence, and state honestly where it does not
lead. The output feeds product positioning and the public README, so an
overstated claim is worse than a missing one.

## Scope

In scope: MCP servers and client plugins whose purpose is giving a coding agent
semantic understanding of a codebase — navigation, types, diagnostics, and
symbol relationships.

Explicitly in scope as a comparison axis: **agent-facing output economics**. Two
tools can expose the same LSP operation and differ by an order of magnitude in
tokens and in whether the response is usable without follow-up reads.

Not in scope: general-purpose file search (ripgrep, find), retrieval-only
semantic search products with no language-server backing, IDE extensions with no
agent interface, and code review or generation products that merely read code.

## Target identity

- Type Atlas `0.2.0`, published to npm and the MCP Registry on 2026-08-08.
- Repository state at the time of research: `main` at `4314ad0`.
- Engine: Volar `@volar/language-server` 2.4.28 with `volar-service-typescript`
  0.0.71, TypeScript 5.9.3.
- MCP SDK `@modelcontextprotocol/server` 2.0.0, serving protocol `2026-07-28`
  with legacy `initialize` still supported.

## Method

READMEs are treated as claims, not evidence. A comparison counts as substantive
only when it rests on at least one of:

- the tool's actual tool list and input schemas, read from its source or a live
  handshake;
- its output for a comparable operation, so response shape and token cost can be
  compared directly;
- its architecture, read from source — how it obtains intelligence, what it
  keeps warm, and what it does per call.

Where only a README claim is available, it is labelled as such.

## Coverage map

| Target                                      | Kind                                   | Basis so far                                                                         | State   |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ | ------- |
| `typescript-lsp@claude-plugins-official`    | Client plugin, Anthropic               | Live head-to-head, 5 operations                                                      | Covered |
| Raw `typescript-language-server` over stdio | The engine every TS bridge wraps       | Driven directly, `documentSymbol` measured                                           | Covered |
| Serena (`oraios/serena`)                    | MCP server, ~60 languages, 27.7k stars | Source-verified: tools, architecture, output shaping, statefulness; issues reviewed  | Covered |
| `agent-lsp` (blackwell-systems)             | MCP server, Go, 65 tools               | Source-verified: tool count, composition, GCF encoding, daemon timeout, CI           | Covered |
| `mcp-language-server` (isaacphi)            | MCP server, Go, 1.5k stars             | Source-verified: 6 tools, unbounded output, abandonment confirmed via PR merge state | Covered |
| `mcpls` (bug-ops)                           | MCP↔LSP bridge, Rust                   | Source-verified: 20 tools, strict 1:1, no token reduction                            | Covered |
| `lsp-mcp-server` (ProfessioneIT)            | MCP server, TypeScript                 | Source-verified: 29 tools, pagination, composition, heuristic tools                  | Covered |
| Raw ripgrep + file reads                    | Baseline every agent already has       | Partial, from session use                                                            | Partial |

## Findings

### Against Anthropic's `typescript-lsp` plugin

Direct observation. Both servers were attached to one Claude Code session and
run against identical symbols in this repository on 2026-08-08.

| Operation                    | Type Atlas                   | `typescript-lsp`   | Outcome                |
| ---------------------------- | ---------------------------- | ------------------ | ---------------------- |
| `hover` on `createTypeAtlas` | correct, with docs and range | correct, with docs | tie                    |
| `findReferences`             | 3 of 17                      | 3 of 17            | tie — both wrong       |
| `workspaceSymbol`            | found cross-package          | **0 results**      | Type Atlas             |
| `incomingCalls` / `callers`  | 3 of 3                       | 3 of 3             | tie                    |
| `documentSymbol`             | 3 lines                      | ~150 lines         | Type Atlas, decisively |

The `documentSymbol` result is the clearest differentiator. On
`packages/mcp/src/dependency-search.ts`, the plugin returned every object-literal
property and every anonymous callback nested six levels deep; Type Atlas returned
the three top-level symbols that exist. Roughly 50× the output to convey less,
and the noise buries the answer.

The plugin is a thin configuration wrapper, not an engine: its directory contains
only `LICENSE` and `README.md`, and the whole plugin is an `lspServers` block
naming the community `typescript-language-server` binary. The `LSP` tool itself
is built into Claude Code. So the comparison is against tsserver behind a generic
9-operation bridge, where every response is raw LSP shaped for an editor.

Honest counterweight: `hover` and `callers` are genuine ties, and the plugin's
caller output is arguably more scannable. Reference recall is tied _and broken_ —
ground truth is 17 references across 6 files; both return 3, because both stop at
the TypeScript project boundary. Type Atlas at least prints
`Scope: project only · packages/core/tsconfig.json`; the plugin says "Found 3
references across 2 files" with no caveat, which reads as complete.

Evidence: session transcript 2026-08-08; ground truth via
`grep -rn "createTypeAtlas" packages --include='*.ts'`.

### Output economics, measured

Direct measurement against `packages/mcp/src/dependency-search.ts`, a 286-line
source file, through the source-mode stdio server on 2026-08-08. Token figures
are characters ÷ 4, which is approximate but consistent across rows.

| Operation                                  | chars  | ≈tokens | vs raw file |
| ------------------------------------------ | ------ | ------- | ----------- |
| Raw file, what `cat` or a plain read costs | 11,038 | ~2,760  | 1.00×       |
| `read_file`, folded (default)              | 7,532  | ~1,883  | 0.68×       |
| `read_file`, `fold: false`                 | 12,181 | ~3,045  | 1.10×       |
| `inspect_symbol` on the file's main export | 1,904  | ~476    | 0.17×       |
| `document_symbols`                         | 271    | ~68     | 0.025×      |
| `list_files`, directories, depth 3         | 326    | ~82     | —           |

#### The same question, three ways

`typescript-language-server` — the exact binary Anthropic's plugin wraps — was
driven directly over stdio and asked `textDocument/documentSymbol` for the same
file, so all three rows below are the same question answered by the same
TypeScript engine.

| Answering `what is in this file?`              | chars  | ≈tokens | vs Type Atlas |
| ---------------------------------------------- | ------ | ------- | ------------- |
| Raw LSP JSON, what a pass-through bridge emits | 31,584 | ~7,896  | 116×          |
| Anthropic plugin's formatted tree (139 nodes)  | ~4,900 | ~1,225  | ~18×          |
| Type Atlas `document_symbols`                  | 271    | ~68     | 1×            |

The raw LSP response is **2.9× larger than the source file it describes**.
Asking a language server what is in a file costs nearly three times more than
reading the file, if nobody edits the answer.

The engine is identical in all three rows. tsserver found 139 symbol nodes; 3
are top-level declarations and 136 are nested object properties and anonymous
callbacks. Type Atlas returns the 3. The plugin returns all 139 as an indented
tree. A naive bridge returns all 139 as JSON with full range objects on each.

This is the sharpest statement of what the product actually is: **the
intelligence is commodity — the editing of the answer is the product.** Anyone
can bridge LSP to MCP. The value is deciding what an agent does not need to see.

Two honest observations that complicate the marketing story:

- **Folding saves less than expected.** 32% on this file, not an order of
  magnitude. The dramatic savings come from asking a _structural_ question
  (`document_symbols` at 2.5% of the file) rather than from folding a read.
  Positioning should lead with "ask the right question" rather than "folded
  reads are cheap."
- **`fold: false` costs 10% more than the raw file**, because line numbers are
  added. Unfolded reads are not a savings mechanism at all; they are a
  convenience with a small premium.

The defensible claim is therefore narrower and stronger than "we use fewer
tokens": Type Atlas makes the _structural_ question answerable, and answering it
costs ~2.5% of reading the file. Against the Anthropic plugin the same
`document_symbols` question returned ~150 lines of nested callbacks and object
properties versus 271 characters here — that comparison is about signal, not
just size.

### Composition, measured

`inspect_symbol` composes eight language-server requests into one call. The
comparison against a one-tool-per-LSP-method bridge is therefore not one call
against one call, but one call against the sequence a client must otherwise run.

Measured on `enrichRetrievalPage` in `packages/mcp/src/intelligence.ts`:

| Separate tools             | chars     |
| -------------------------- | --------- |
| `hover`                    | 437       |
| `definitions`              | 102       |
| `type_definitions`         | 678       |
| `implementations`          | 84        |
| `references`               | 376       |
| `callers`                  | 473       |
| `callees`                  | 5,390     |
| **total across 7 calls**   | **7,540** |
| `inspect_symbol`, one call | **1,861** |

**4.05× fewer characters and 7× fewer round trips** for the same working picture.

Round trips matter more than the character ratio. Each separate call is a model
turn — inference, tool call, result — so seven calls is seven turns of latency
before the agent knows anything. This is also the axis where a bridge exposing
LSP one-to-one is structurally unable to compete, regardless of how well it
formats individual responses.

Where the saving comes from, honestly:

- `callees` alone is 5,390 of the 7,540 characters, because it enumerates every
  dependency and runtime call target. `inspect_symbol` summarizes those by
  default (`compactExternalCalls`), keeping exact ranges only for workspace
  calls. Most of the ratio is that one decision.
- Sections in `inspect_symbol` are bounded by `limit`, so it is a _working view_,
  not a complete manifest. For exhaustive enumeration the separate tools with
  `raw: true` are still the correct choice. The claim is "one call to understand
  a symbol," not "one call replaces all seven in every case."

### Ambient diagnostics, verified

A file containing one deliberate type error was created and queried with
`document_symbols` — a purely structural request that says nothing about
diagnostics:

```
Symbols (2 top-level) · packages/core/src/__ambient_probe.ts
ok [variable] selection 2:14-2:16; body 2:14-2:20
wrong [variable] selection 1:14-1:19; body 1:14-1:40

Diagnostics: 1 error · packages/core/src/__ambient_probe.ts
error ts(2322) 1:14-1:19
  Type 'string' is not assignable to type 'number'.
```

The error arrived without being requested, with its exact message and range, for
roughly 130 additional characters.

This matters more for agents than for editors. An editor shows diagnostics
continuously in the gutter, so a human cannot miss them. An agent only learns
what it asks about, and an agent that has just edited code frequently does not
think to ask. Attaching diagnostics to every file-scoped response converts
"remembered to check" into "cannot miss." No competitor examined so far has
been confirmed to do this; it is a specific question for each.

### Beyond TypeScript, verified — with one defect found

Markdown and JSON are served by the same server, same tools, same output shape.
This is a real differentiator against every TypeScript-only or per-language
bridge: one server answers structural questions about source, docs, and config.

JSON is the strongest case. `document_symbols` on `package.json` returns keys
with their **values inline**, so an agent learns the content without a second
read:

```
name [string] selection 2:3-2:9; body 2:3-2:23 — type-atlas
private [boolean] selection 3:3-3:12; body 3:3-3:18 — true
license [string] selection 4:3-4:12; body 4:3-4:26 — Apache-2.0
```

Markdown returns a real heading outline once `depth` is raised; at the default
it collapses to the single top heading, which is correct behavior but easy to
mistake for a broken result on a document with one `#`.

**Defect found: `document_links` leaks editor-host commands.** On this README,
2 of 5 returned "links" are VS Code internal commands:

```
129:23-129:35 -> command:revealInExplorer?[{"$mid":1,"external":"file:///…/packages/mcp",
                 "path":"/Users/…/packages/mcp","scheme":"file"}]
  Follow link
```

A `command:revealInExplorer` URI is meaningless outside a VS Code window. It is
an editor artifact reaching agent output, costing ~200 characters each — exactly
the category of noise this product exists to remove. Filing as a real bug rather
than presenting `document_links` as a strength.

### Tool surface cost — where Type Atlas is worst

Measured from a live `tools/list`:

|                           | value                         |
| ------------------------- | ----------------------------- |
| tools                     | 35                            |
| full `tools/list` payload | 61,734 chars                  |
| ≈ tokens                  | **~15,400**                   |
| mean per tool             | 1,764 chars                   |
| largest schema            | `explore_symbol`, 3,976 chars |
| second largest            | `inspect_symbol`, 3,793 chars |

**Describing the tools costs ~15,400 tokens before any work happens.** A client
that holds all schemas in context pays that on every request. That is a larger
number than any per-call saving reported above, and it must not be omitted from
positioning.

There is a direct tension here: the two most valuable tools, `inspect_symbol`
and `explore_symbol`, carry the two largest schemas. Composition saves call-time
tokens and costs schema tokens.

This also explains a client-behavior difference observed firsthand. Claude Code
defers these 35 schemas behind a `ToolSearch` step, so the model fetches a schema
before first use — an extra model turn per tool, and a schema it may later be
working from memory rather than verbatim. Codex keeps MCP schemas inline
permanently, which is why its agents malform fewer calls but pay the ~15,400
tokens continuously. Neither is strictly better; the cost is real either way and
it is proportional to tool count.

Consequence for the comparison: a server advertising 65 tools is not obviously
richer than one advertising 24. Tool count is a **cost** as much as a feature,
and any competitor's count should be read as schema weight, not capability.
Type Atlas at 35 sits in the middle and has real consolidation available —
`definitions`, `type_definitions`, `implementations`, `callers`, `callees`, and
`references` are all subsets of what `inspect_symbol` already returns.

### Against Serena (`oraios/serena`)

The most serious competitor by a wide margin: 27,759 stars, ~60 languages, and a
scope far beyond code navigation. Snapshot 2026-08-08, `main`. Findings below are
source-verified unless marked otherwise.

**Architecture.** Serena spawns real language-server binaries as subprocesses
through its own client library, `solidlsp` (`src/solidlsp/ls.py`). For
TypeScript it launches `typescript-language-server --stdio`
(`src/solidlsp/language_servers/typescript_language_server.py:250-295`), pinned
to TypeScript 5.9.3 — **the same engine Anthropic's plugin wraps**. Type Atlas
drives Volar directly instead. Serena additionally self-installs each language's
server binary on first use, which is a genuine operational advantage a bridge
that assumes a preinstalled binary does not have.

**Tool surface.** 52 registered tool classes; 29 default-enabled on the LSP
backend (`ToolRegistry.get_tool_classes_default_enabled`,
`src/serena/tools/tools_base.py:626-630`), with 13 more only active under a
JetBrains plugin backend. Schemas are generated from `apply()` signatures and
docstrings (`src/serena/mcp.py:60-97`) rather than hand-written. So 29 default
tools against Type Atlas's 35 — comparable weight, not a differentiator either
way.

**Output shaping — Serena is strong here, and this narrows a claim I made
above.** It does not pass raw LSP through. `Tool._limit_length`
(`tools_base.py:281-311`) accepts a cascade of progressively shorter renderings
and walks them until one fits the budget; `SearchForPatternTool`
(`file_tools.py:604-659`) defines **five** levels, degrading from full matched
lines through line-numbers-only to per-file counts to a one-line summary. It also
genuinely folds rather than merely truncating: `LanguageServerSymbolDictGrouper`
(`src/serena/symbol.py:1296-1316`) regroups symbols by kind and collapses
singletons. Type Atlas cannot claim to be the only tool that thinks about output
economics — Serena thinks about it carefully, and its degradation ladder is
arguably more sophisticated than Type Atlas's fixed formatting.

**Where Type Atlas is genuinely better**

- _Composition._ Serena is mostly one tool per LSP method. It fuses exactly two
  things: hover into symbol search via `include_info=True`
  (`symbol.py:620-670`), and references into diagnostics via
  `check_symbol_references=True`. There is no single "everything about this
  symbol" call. `inspect_symbol`'s eight-request composition, and its treatment
  of references as the residual after callers and definitions, has no Serena
  equivalent.
- _Scope honesty, and this is the sharp one._ Serena attaches no scope or
  completeness marker to results. Open issue
  [#1814](https://github.com/oraios/serena/issues/1814) documents
  `find_referencing_symbols` returning `{}` with `isError: false` after tsserver
  died of OOM on a large monorepo — while logging "cross-file indexing
  complete". An agent cannot distinguish that from "this symbol has no
  references." Type Atlas printing `Scope: project only · <tsconfig>` on every
  reference result is the discipline that prevents exactly this class of silent
  wrong answer. (Third-party issue report, not independently reproduced.)
- _Ambient diagnostics._ Serena exposes `get_diagnostics_for_file` and
  `get_diagnostics_for_symbol` as tools an agent must remember to call. Type
  Atlas attaches diagnostics to every file-scoped response unasked.

**Where Serena is genuinely better, and Type Atlas should not pretend otherwise**

- _Language breadth._ ~60 languages against TypeScript, Markdown, and JSON.
  For anyone not in a TypeScript codebase this decides the matter outright.
- _Persistent caching._ Document-symbol caches are pickled to disk per project,
  keyed by file-content hash, and survive process restarts
  (`src/solidlsp/ls.py:348-562`). Type Atlas rebuilds its TypeScript program on
  every cold start.
- _No idle eviction._ Language servers stay warm for the project's lifetime with
  no idle timeout found anywhere in `ls_manager.py`. Type Atlas shipped a
  60-second window until 2026-08-08 and now uses 30 minutes — still an eviction
  policy Serena simply does not have.
- _Scope of product._ Cross-session project memories, an onboarding flow, and
  bulk edits with dry-run diffs and id-revalidation before writing
  (`file_tools.py:218-448`). Type Atlas has no equivalent to any of these.

**Serena's real weaknesses**, mostly from issue volume rather than source:
silent false-empty results (#1814); all-or-nothing startup where one missing
language server blocks every other language (#1670); a performance cliff when
`include_info=True` on heavy servers, making symbolic search "inoperative" on
large C++ projects (#951); `replace_symbol_body` duplicating code (#576, 41
comments); ~30GB memory growth freezing host sessions (#944); and startup or
connection failure as the single largest complaint category by comment volume
(#494, #257, #336, #1390, #368). That last cluster is the predictable cost of
managing a fleet of external subprocess language servers across platforms.

**Honest summary.** Serena is a larger, more ambitious, more widely adopted
product that happens to include code navigation. Type Atlas is a smaller tool
that does TypeScript navigation more carefully — better composition, honest
scoping, diagnostics you cannot forget to ask for. Positioning should not claim
to beat Serena generally. The defensible claim is narrower: _for a TypeScript
codebase, Type Atlas answers a symbol question in one call and tells you what it
does not know._

### Volar versus tsserver — the architectural difference, verified

Serena and Anthropic's plugin both wrap `typescript-language-server`, which
wraps tsserver. Type Atlas drives Volar. The difference is not answer quality on
a TypeScript question — it is what one process can answer.

Verified by driving the server and counting its children:

```
packages/core/src/operations.ts  -> Symbols (4 top-level)
README.md                        -> Symbols (1 top-level)
package.json                     -> Symbols (8 top-level)

language-server subprocesses spawned by this MCP server: 1
```

**One** language server answers TypeScript, Markdown, and JSON. That is Volar's
composition model: `createTypeScriptProject` with
`[...createTypeScriptServices, createJsonService, createMarkdownService]`
layered over one document model
(`packages/language-server/src/server.ts:103-117`).

A tsserver-based bridge cannot do this, because tsserver only speaks TypeScript.
Serena's answer is one language-server module per language — roughly 60 of them
in `src/solidlsp/language_servers/` — each spawning its own process, each
self-installed, each a separate failure point. That is the direct cause of its
most-reported problem class: one missing or failing server blocking the others
(#1670), and startup fragility as the top complaint by comment volume.

So the honest framing of the architectural claim is about **process economy and
failure surface**, not about smarter TypeScript. One warm process, one project
model, one config, one thing to fail — covering source, docs, and config
together. It scales worse across languages and better within a project.

### Against `agent-lsp` (blackwell-systems, Go)

The closest architectural competitor found, and the one that most directly
contests Type Atlas's differentiators. Snapshot 2026-08-08.

**Its tool count claim is real.** 65 tools, grep-verified across 9 registration
files in `cmd/agent-lsp/`. Unusually, the marketing number survives a source
count. 14 hardcoded language→binary pairs
(`internal/config/autodetect.go:20-36`), resolved from `$PATH`; the user installs
the servers. The "30 CI-verified languages" claim is also real — 30 fixture
directories with CI that installs genuine language-server binaries and runs
integration tests against them.

**Composition — this refutes a claim I made above.** `internal/tools/explore.go`
implements `explore_symbol` as a deliberate composite: hover + call hierarchy +
document symbols + references, merged into one response. `safe_edit`,
`blast_radius`, and `change_impact` are further composites. Type Atlas's
`inspect_symbol` is therefore **not** a unique idea; it is the same idea, arrived
at independently. The earlier statement that composition "has no equivalent" is
true only of Serena and mcpls, and has been narrowed accordingly.

**Token economics — they instrument what Type Atlas only asserts.**
`internal/tools/token_savings.go:13-25` computes `tokens_returned`,
`tokens_full_file`, and `tokens_saved` using the same characters÷4 heuristic used
in this document, and attaches them as `_meta.token_savings` on `list_symbols`,
`get_symbol_source`, and `get_editing_context`. They also ship an opt-in
alternate encoding, GCF, claiming 30–84% fewer tokens
(`internal/tools/helpers.go:156-186`; opt-in via `AGENT_LSP_OUTPUT_FORMAT`, JSON
remains default). Type Atlas has no equivalent self-measurement. If output
economics is the pitch, a competitor that reports its own savings per call is
ahead on credibility.

Worth noting they hit a real hazard with it: edit payloads are forced back to
JSON because GCF's positional flattening caused models to corrupt
`WorkspaceEdit` round-trips (`helpers.go:188-196`, issue #12). Aggressive
encoding has a correctness cost.

**Convergent validation of the idle window.** `daemon_broker.go:38` sets
`daemonInactivityTimeout = 30 * time.Minute` for its persistent language-server
daemons — the exact value Type Atlas moved to on 2026-08-08 after measuring
cold-start cost. Two projects independently landing on 30 minutes is decent
evidence the number is right. Their design goes further: the daemon survives the
MCP process itself, giving cross-session warmth Type Atlas does not have.

**Where Type Atlas still leads:** scope honesty remains unmatched — no evidence
`agent-lsp` reports which project a reference result came from. Ambient
diagnostics also appear absent; `get_diagnostics` is a tool an agent must
remember to call.

**Where `agent-lsp` leads:** 30 languages, speculative-edit simulation sessions
(`create_simulation_session`/`simulate_edit`/`commit_session`), build and test
runners, cross-repo references, cross-session daemon persistence, and token
self-instrumentation.

**Maturity is the honest counterweight.** 101 stars, created 2026-04-06, and
effectively a single maintainer — 1,432 commits against 1 from anyone else.
Extensive tests and real CI, but the bus factor is one, and a 65-tool surface is
a large thing for one person to keep correct.

### Against `mcpls` (bug-ops, Rust)

The control case: what a deliberately thin bridge looks like. 20 tools verified
from both `tool_surface.json` and 20 `#[tool]` macros in `mcp/server.rs`, in
**strict one-tool-per-LSP-method** mapping with zero composition — the project's
own vocabulary is "translator."

It does transform output into simplified DTOs (`bridge/translator/dto.rs`)
rather than passing raw LSP through, and converts LSP's 0-based positions to
1-based for MCP callers — the same choice Type Atlas made. But there is **no
token-reduction technique at all**: no folding, collapsing, or summarizing. Its
only size discipline is defensive byte caps on cached diagnostics and logs, added
reactively during a CWE-400 security pass, not as an efficiency feature. It makes
no token claims, which is at least consistent.

No idle timeout, no cross-session persistence; warm for the stdio process
lifetime, with exponential-backoff respawn on crash. 57 stars, 6 contributors,
CodeQL scanning, and an open-issue list that is mostly self-filed audit findings
— a smaller but visibly disciplined project.

`mcpls` is the useful baseline for the central argument: it proves that bridging
LSP to MCP faithfully is the easy part, and that doing it without deciding what
an agent should not see leaves all the output economics on the table.

### Against `mcp-language-server` (isaacphi, Go)

The most-starred pure bridge at 1,574 stars, and the cautionary case.

Six tools: `edit_file`, `definition`, `references`, `diagnostics`, `hover`,
`rename_symbol` (`tools.go:11-368`). Bring-your-own language server — the binary
is an arbitrary `--lsp` flag, with no built-in roster.

**Output is where it loses decisively.** `definition` reads the symbol's entire
body from disk and returns it line-numbered with **no size cap**
(`internal/tools/lsp-utilities.go:15-139`) — a 2,000-line function returns 2,000
lines. `references` and `diagnostics` bound each hit to a ±5-line window but
place **no cap on hit count**, so a 500-reference symbol yields 500 blocks with
no pagination. This is the closest thing found to a worked example of the
failure Type Atlas's output discipline exists to prevent.

**It is effectively abandoned.** Last merge to `main` is 2025-06-03, over 14
months stale; `pushed_at` looks recent only because of unmerged dependabot
branches. Every recently closed PR across March–July 2026 shows `merged_at:
null`, including fixes for defects independently confirmed in its source. Its
integration test suite — real gopls, pyright, rust-analyzer, tsserver, clangd,
with ~150 committed snapshots — is genuinely good work that is no longer being
accepted into.

Star count is therefore a poor proxy for whether a tool is a live alternative.

### Against `lsp-mcp-server` (ProfessioneIT, TypeScript)

29 tools, single maintainer, 20 stars, actively developed through mid-2026. The
"24 tools" figure in third-party directories is stale, traced to a dev-doc
comment predating a 2026-05-13 commit that added five tools.

Closest to Type Atlas in output philosophy: structured responses,
`locationToResult()` giving **exactly one trimmed source line per hit**
(`src/tools/utils.ts:79-113`) — more compact per hit than any other competitor —
and real offset/limit pagination on `lsp_find_references` with
`{total_count, returned_count, offset, has_more}`. It also composes:
`lsp_smart_search` fires up to six LSP requests and merges them, each
individually try/caught so partial failures survive.

But the discipline is uneven. `lsp_diagnostics` has no count limit at all,
`lsp_hover` passes raw markdown through untruncated, and every response is
`JSON.stringify(result, null, 2)` — two-space-indented JSON, which spends
significant tokens on braces, quotes, and repeated keys where Type Atlas emits
plain text.

**A caution worth carrying into our own claims.** Three of its tools —
`lsp_file_imports`, `lsp_related_files`, `lsp_file_exports` — are regex and
substring heuristics that never call an LSP method, and silently return empty
for Python, Go, Rust, and Java despite the project's "10 languages" framing. The
code admits it in its own output: _"For true export detection, check if symbols
are prefixed with 'export' in the source."_ Presenting heuristics under a
semantic banner is the specific dishonesty this document exists to avoid.

Tests are unit-only; the declared integration config file does not exist in the
repo, and there is no GitHub CI (it mirrors a private Forgejo instance).

### Against the baseline every agent already has

Type Atlas covers three of four ways an agent looks for code — by structure
(`list_files`), by name (`workspace_symbols`), and by concept (`search_code`). It
does not cover exact text. Verified: searching the literal string
`"Semantic search requires uvx"`, which exists verbatim at
`packages/mcp/src/semble.ts:111`, ranked the wrong file first and returned a
snippet that stopped before the matching line.

This is a deliberate boundary rather than an oversight, and the server
instructions now direct agents to their client's own text search for exact text.
It remains a real dependency on the host: an agent with Type Atlas alone cannot
find an error message, a `TODO`, or anything in a `.yaml`, `.env`, or lockfile.

## Synthesis: what survives contact with the competition

Six targets examined from source. Here is what is actually defensible.

### A warning about the scoreboard below

The rows in the first table were chosen by Type Atlas's author, from the list of
things Type Atlas does. That is selection bias, and it produces a table where
Type Atlas has four exclusive columns and appears to be the most capable option
— which the rest of this document says it is not.

The second table lists the rows a Serena or `agent-lsp` author would have picked.
Read both, or neither.

### The cross-cutting scoreboard

|                              | Type Atlas   | Serena     | agent-lsp       | mcp-language-server | lsp-mcp-server | mcpls     |
| ---------------------------- | ------------ | ---------- | --------------- | ------------------- | -------------- | --------- |
| Tools                        | 35           | 29         | 65              | 6                   | 29             | 20        |
| Languages                    | TS, MD, JSON | ~60        | 30              | any (BYO)           | 10             | any (BYO) |
| Composed symbol view         | **yes**      | partial    | **yes**         | no                  | yes            | no        |
| Structural folding of bodies | **yes**      | no         | no              | no                  | no             | no        |
| Diagnostics unasked          | **yes**      | no         | no              | no                  | no             | no        |
| Reports result scope         | **yes**      | no         | no              | no                  | no             | no        |
| One process, many file types | **yes**      | no         | no              | no                  | no             | no        |
| Idle window                  | 30 min       | none       | 30 min (daemon) | none                | 30 min         | none      |
| Cross-session warmth         | no           | disk cache | **yes**         | no                  | no             | no        |
| Self-measured token savings  | no           | no         | **yes**         | no                  | no             | no        |
| Editing tools                | patches only | **yes**    | **yes**         | **yes**             | yes            | no        |
| Maintainers                  | small        | large      | **1**           | stalled             | 1              | few       |

### The same comparison, rows chosen by the competition

|                                   | Type Atlas | Serena    | agent-lsp | mcp-language-server | lsp-mcp-server | mcpls |
| --------------------------------- | ---------- | --------- | --------- | ------------------- | -------------- | ----- |
| Languages supported               | 3          | **~60**   | 30        | any                 | 10             | any   |
| Installs language servers for you | no         | **yes**   | no        | no                  | no             | no    |
| Cross-session project memory      | no         | **yes**   | no        | no                  | no             | no    |
| Guided onboarding of a codebase   | no         | **yes**   | no        | no                  | no             | no    |
| Symbol-level structural edits     | no         | **yes**   | **yes**   | partial             | no             | no    |
| Speculative edit sessions         | no         | no        | **yes**   | no                  | no             | no    |
| Build and test runners            | no         | no        | **yes**   | no                  | no             | no    |
| Cross-repo references             | no         | no        | **yes**   | no                  | no             | no    |
| Persistent cache across restarts  | no         | **yes**   | **yes**   | no                  | no             | no    |
| Rename with dry-run preview       | no         | no        | **yes**   | no                  | **yes**        | no    |
| Multi-server polyglot fan-out     | no         | **yes**   | **yes**   | no                  | **yes**        | no    |
| Self-reported token savings       | no         | no        | **yes**   | no                  | no             | no    |
| Adaptive output degradation       | no         | **yes**   | no        | no                  | no             | no    |
| Adoption (stars)                  | ~0         | **27.7k** | 101       | 1.5k                | 20             | 57    |

Type Atlas scores **zero** on thirteen of fourteen rows here. Both tables are
accurate. Neither is complete. That is the honest state of the comparison, and
it is why the positioning below is narrow rather than triumphant.

### The three claims that hold up

**1. Structural folding is genuinely rare.** Across all five competitors, none
performs general structural collapsing of function bodies. Serena has the most
sophisticated _degradation_ ladder — five levels from full lines down to
counts — but that is truncation under budget pressure, not folding. agent-lsp
folds context windows for references only. `mcp-language-server` returns whole
function bodies uncapped. Type Atlas folding a file into signatures with bodies
collapsed is, on this evidence, distinctive.

**2. Scope honesty is unmatched.** No competitor reports which project or index
produced an answer. Serena's issue #1814 shows the consequence in production: an
empty result with `isError: false` after the language server died, logged as
"indexing complete," indistinguishable from a symbol genuinely having no
references. Type Atlas printing `Scope: project only · <tsconfig>` is a small
line of text that is, as far as this research found, unique — and the failure it
prevents is the worst one in the category, because the agent cannot detect it.

**3. Ambient diagnostics are unmatched.** Every competitor exposes diagnostics as
a tool the agent must remember to call. Only Type Atlas attaches them to
responses the agent asked for other reasons.

### The claims that must be dropped or softened

- **"Composition is our idea."** False. agent-lsp's `explore_symbol` fuses
  hover, call hierarchy, symbols, and references; `lsp-mcp-server`'s
  `lsp_smart_search` fires six requests and merges. Composition is convergent
  design, not a moat. The 4× character and 7× round-trip figures remain true and
  worth stating; uniqueness does not.
- **"We're the token-efficient one."** agent-lsp instruments and reports its own
  savings per call, which Type Atlas does not. Serena's degradation ladder is
  more adaptive than our fixed formatting. We are good here; we are not alone,
  and one competitor can prove its numbers where we assert ours.
- **"35 tools is richness."** It is ~15,400 tokens of schema. agent-lsp's 65 is
  worse, `mcp-language-server`'s 6 is leaner. Tool count is a cost.

### The honest one-sentence position

_For a TypeScript codebase, Type Atlas answers a symbol question in one call,
folds what you did not ask for, tells you what it does not know, and shows you
the errors you forgot to check for — from a single process that also
understands your Markdown and JSON._

Everything in that sentence is measured or source-verified above. It does not
claim to be the most capable, the most languages, or the only token-conscious
option, because none of those would survive scrutiny.

### Who should pick something else

- **Not a TypeScript project** → Serena, decisively.
- **Want simulation sessions, build/test runners, cross-repo analysis** →
  agent-lsp, accepting single-maintainer risk.
- **Want a thin, auditable 1:1 LSP bridge** → mcpls.
- **Want cross-session project memory and onboarding** → Serena.

Recommending against yourself where the answer is clear is what makes the rest
of the comparison believable.

## Convergent design, as validation

Three findings where competitors independently reached the same conclusion,
which is stronger evidence than any single project's reasoning:

- **30-minute idle windows.** `agent-lsp` sets
  `daemonInactivityTimeout = 30 * time.Minute` (`daemon_broker.go:38`);
  `lsp-mcp-server` sets `idleTimeout: 1800000` (`constants.ts:121`). Type Atlas
  moved from 60 seconds to exactly 30 minutes on 2026-08-08 after measuring
  cold-start cost. Three projects, same number, arrived at separately.
- **1-based positions at the MCP boundary.** `mcpls` converts LSP's 0-based
  positions to 1-based for callers (`dto.rs:6-13`), as Type Atlas did in the same
  release. Editors display 1-based; agents reason in editor terms.
- **Output must be transformed, never passed through.** All five competitors
  build their own response shapes. Nobody ships raw LSP JSON. The measurement
  above explains why: raw `documentSymbol` for one file is 31,584 characters,
  2.9× the source file itself.

## Unresolved questions

- **Cross-project reference recall is unsolved everywhere.** Type Atlas and the
  Anthropic plugin both return 3 of 17. No competitor was found to solve it, and
  none except Type Atlas even reports the boundary. This is simultaneously our
  clearest weakness and, because we disclose it, our clearest differentiator.
  Fixing it while keeping the disclosure would be the strongest single
  improvement available.
- **Competitor schema weight is unmeasured.** Type Atlas is ~15,400 tokens for
  35 tools. Comparable `tools/list` figures for Serena (29) and agent-lsp (65)
  would need those servers actually running; not attempted. The per-tool mean
  here (1,764 chars) suggests agent-lsp is likely worse and
  `mcp-language-server` far leaner, but that is inference, not measurement.
- **No competitor was benchmarked live.** Every competitor finding is
  source-verified, not runtime-verified. Type Atlas's numbers come from
  execution; theirs come from reading their code. That asymmetry is stated
  wherever it matters but is not eliminated, and it is the single largest
  methodological weakness in this document.
- **Serena's marketplace listing** is locally verified only: the Anthropic
  marketplace manifest read on 2026-08-08 lists `serena` under
  `external_plugins/serena`, tagged `community-managed`. The subagent could not
  confirm it independently.
- **`document_links` leaks VS Code `command:` URIs**, found during this research
  and filed as a follow-up. Not a competitive matter, but it undercuts the
  "no editor artifacts" story until fixed.

## Resumption point

Coverage is sufficient for the positioning goal; the six comparison targets are
examined and the synthesis is written. If research resumes, the highest-value
next slices, in order:

1. **Run one competitor live** — ideally Serena, since it is the most likely
   alternative — and measure the same `document_symbols` and symbol-inspection
   operations used here. That converts the strongest section of this document
   from source-verified to measured, and removes the methodological asymmetry
   noted above.
2. **Measure competitor `tools/list` payloads** to complete the schema-weight
   comparison.
3. **Re-check `mcp-language-server`'s maintenance status** before citing it as
   abandoned in anything public; the finding is well-evidenced but consequential
   to say out loud, and could change.
