<!-- Generated from README.mdoc by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->
<div align="center">

<img src="packages/mcp/assets/type-atlas.png" width="112" alt="" />

# Type Atlas

[![npm](https://img.shields.io/npm/v/%40type-atlas%2Fmcp?style=flat-square&label=npm&color=2b7489)](https://www.npmjs.com/package/@type-atlas/mcp)
[![node](https://img.shields.io/node/v/%40type-atlas%2Fmcp?style=flat-square&color=417e38)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/%40type-atlas%2Fmcp?style=flat-square&color=8250df)](LICENSE)

</div>

Type Atlas is an MCP server for code intelligence. A Volar language server
answers from the TypeScript project that owns each file, so definitions,
references, types, diagnostics, and ranges match what an editor shows.

Responses are written for a context window instead of a screen. A file outline
is the declarations in it, not every nested callback. A read folds bodies to
signatures. `inspect_symbol` composes eight language-server requests into one
answer. Every answer states the scope it covered and what it cost.

I use it every day, on a large monorepo maintained almost entirely by agents.

TypeScript, Markdown, and JSON. Node 22.20 or newer. Apache-2.0.

## Install

```sh
codex mcp add type-atlas -- npx --yes @type-atlas/mcp@latest

claude mcp add --scope user type-atlas -- npx --yes @type-atlas/mcp@latest

code --add-mcp '{"name":"type-atlas","command":"npx","args":["--yes","@type-atlas/mcp@latest"]}'
```

Any other client takes the standard shape:

```json
{
  "mcpServers": {
    "type-atlas": {
      "command": "npx",
      "args": ["--yes", "@type-atlas/mcp@latest"]
    }
  }
}
```

Claude Desktop reads its own list at
`~/Library/Application Support/Claude/claude_desktop_config.json`, and starts
servers without your shell `PATH`, so give the absolute path from `which npx`
if it fails to start. On Windows, a client that cannot launch the `npx.cmd`
shim needs `"command": "cmd"` with
`"args": ["/c", "npx", "--yes", "@type-atlas/mcp@latest"]`.

Clients read MCP config at startup, so restart after. `@latest` resolves on
every process start; pin a version if you do not want tool behavior moving
under you.

`search_code`, `related_code`, `investigate_code`, and `search_dependency_code`
run a semantic index through `uvx` and need
[uv](https://docs.astral.sh/uv/getting-started/installation/). Without it those
four report that uv is missing, `explore_symbol` drops its related-code
section, and the rest is unaffected.

### Recommended

Installing the server does not change what an agent reaches for. Claude will
assemble whatever its shell allows, chained together, and produce a fresh
justification each time, so naming a few commands to avoid does not hold. The
instruction has to rule out the whole category and name the exceptions. Add
this to `AGENTS.md` or `CLAUDE.md`:

> Type Atlas MCP is the required tool for reading and navigating code in
> TypeScript and JavaScript. This is not a preference. No shell command is an
> acceptable substitute, whatever it is composed of, and neither is a plain
> file read. The only valid fallbacks are a server that is down, a call that
> errored, or a file that is neither TS nor JS.

### `--require-intent`

With this flag, a read-only call has to carry one sentence naming the decision
it serves, and that sentence is echoed above the answer. A call without one
fails.

```sh
codex mcp add type-atlas -- npx --yes @type-atlas/mcp@latest --require-intent
```

This is for agents that navigate far past what their change needs and cannot
say why afterwards. Off by default.

## Tools

| Question                         | Tools                                                                                                                                                                              |
| :------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand a symbol, in one call | `inspect_symbol` · `explore_symbol`                                                                                                                                                |
| Navigate a relationship in full  | `definitions` · `type_definitions` · `implementations` · `callers` · `callees` · `references` · `file_references` · `document_highlights` · `document_symbols` · `workspace_symbols` |
| Read economically                | `read_file` · `list_files`                                                                                                                                                         |
| Stay correct while editing       | `diagnostics` · `code_actions` · `organize_imports` · `add_missing_imports` · `remove_unused_code` · `fix_all` · `format_document` · `rename_symbol` · `rename_files`              |
| Understand a dependency          | `list_module_exports` · `search_dependency_code`                                                                                                                                   |
| Find code by meaning             | `search_code` · `related_code` · `investigate_code`                                                                                                                                |
| Prove exact text                 | `occurrences`                                                                                                                                                                      |

Paths are workspace-relative, coordinates are one-based, so a location in one
answer is valid input to the next call. Editing tools return patches; nothing
is written for you. Per-tool pages with more cases are in
[docs/tools](docs/tools/).

## Output

Everything below is captured from the running server against
[`fixtures/ledger`](fixtures/ledger/) by the
[scenario suite](packages/mcp/test/scenarios/), which replays the same calls
and fails on drift. Nothing here is hand-written, and changing what a tool
answers changes this file in the same commit. The source is
[`README.mdoc`](README.mdoc).

### `inspect_symbol`

Hover, definitions, type definitions, implementations, callers, calls, and
references in one call. References are the residual after callers and
definitions are accounted for, so a use is listed once. Against calling those
tools separately it is 4x fewer characters and 7x fewer round trips.

**Agent's Input**

```yaml
tool: Inspect symbol
workspace: fixtures/ledger
file: packages/accounts/src/journal.ts
symbol: Journal
# answered in under 1s
```

**Response**

~~~text
Journal [class] · packages/accounts/src/journal.ts:24:14-24:21 · range 24:1-73:2 · packages/accounts/tsconfig.json

```typescript
class Journal<TMeta = undefined>
```

An append-only journal of balanced entries. `TMeta` carries whatever a
consumer attaches to each entry — an import batch id, an approval trail —
without the journal knowing its shape.

## Callers (4)

packages/accounts/tests/journal.test.ts
├  test("posts a balanced transfer through the overload") callback [function] 5:56-14:2 · calls 6:23-6:30
└  test("refuses an unbalanced entry") callback [function] 16:37-29:2 · calls 17:23-17:30
packages/reports/src/balance.ts
└  balancesAsOf [variable] 23:14-23:26 · range 23:14-51:2 · calls 24:12-24:19
packages/importers/src/csv.ts
└  importStatement [variable] 28:14-28:29 · range 28:14-47:2 · calls 29:12-29:19

## Mentions that are not calls (4 of 9 references · 9 projects loaded)

packages/accounts/tests/journal.test.ts:3:25-3:32:  import { credit, debit, Journal, UnbalancedEntryError } from "../src/index.ts";
packages/accounts/src/index.ts:11:22-11:29:  export { type Entry, Journal, UnbalancedEntryError } from "./journal.ts";
packages/reports/src/balance.ts:4:8-4:15:  type Journal,
packages/importers/src/csv.ts:1:10-1:17:  import { Journal, type Entry, credit, debit, type AccountPath } from "@ledger/accounts";

references lists all 9, with paging.
~~~

### `document_symbols`

An outline arrives with the file's diagnostics attached. Editors put errors in
the gutter so a human cannot miss them. An agent only sees what it asked for,
and an agent that just edited code usually does not think to ask.

**Agent's Input**

```yaml
tool: Document symbols
workspace: fixtures/ledger
file: packages/reconcile/src/drift.ts
# answered in under 1s
```

**Response**

~~~text
=== packages/reconcile/src/drift.ts · 3 top-level symbols ===

drift [variable] 19:14-19:19 · range 19:14-22:2
StatementLine [interface] 8:18-8:31 · range 8:1-12:2
statementTotal [variable] 15:14-15:28 · range 15:14-16:56

4 problems in packages/reconcile/src/drift.ts
~~~

### `read_file`

The argument is an array, so several files arrive in one call. Bodies fold to
signatures by default and the header says how many lines that saved; `fold:
false` returns them.

**Agent's Input**

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/accounts/src/posting.ts","packages/money/src/rounding-mode.ts"]
# answered in under 1s
```

**Response**

~~~text
2 files · 42 lines · 6 folded to signatures, pass fold: false for the bodies

=== packages/accounts/src/posting.ts · 32 lines ===

 1 | import { type Money, negate } from "@ledger/money";
 2 | import type { AccountPath } from "./account.ts";
 3 |
 4 | /**
 5 |  * One side of a journal entry. The discriminant is the bookkeeping side, so
 6 |  * every consumer's switch is checked for exhaustiveness by the compiler.
 7 |  */
 8 | export type Posting =
 9 |   | { readonly side: "debit"; readonly account: AccountPath; readonly amount: Money }
10 |   | { readonly side: "credit"; readonly account: AccountPath; readonly amount: Money };
11 |
12 | export const debit = (account: AccountPath, amount: Money): Posting => ({
13 |   side: "debit",
14 |   account,
15 |   amount,
16 | });
17 |
18 | export const credit = (account: AccountPath, amount: Money): Posting => ({
19 |   side: "credit",
20 |   account,
21 |   amount,
22 | });
23 |
24 | /** A posting's effect on a debit-normal running balance. */
25 | export const signedAmount = (posting: Posting): Money => {
   |   ... 26-31 folded
32 | };

=== packages/money/src/rounding-mode.ts · 15 lines ===

 1 | /** How sub-minor precision resolves when a statement and the books disagree. */
 2 | export enum RoundingMode {
 3 |   HalfUp = "half-up",
 4 |   HalfEven = "half-even",
 5 |   Truncate = "truncate",
 6 | }
 7 |
 8 | /** Per-institution conventions, as observed in their exports. */
 9 | const bankRounding: Readonly<Record<string, RoundingMode>> = {
10 |   "first-national": RoundingMode.HalfEven,
11 |   "harbor-credit": RoundingMode.HalfUp,
12 | };
13 |
14 | export const roundingModeOf = (bank: string): RoundingMode =>
15 |   bankRounding[bank] ?? RoundingMode.HalfEven;
~~~

### `list_files`

Structure, line counts, and `git status` in one tree, using the badge letters
editors already use. Deleted files get a row even though they exist only in
git's answer. Folded directories say what they hold rather than disappearing.

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
# working tree arranged: currency.ts edited · rounding.ts created · index.ts deleted
directory: packages/money
depth: 2
# answered in under 1s
```

**Response**

~~~text
packages/money/
├  src/ · 3 changed
│  ├  currency.ts · 21 loc · M +2
│  ├  index.ts · D -12
│  ├  money.ts · 58 loc
│  ├  rounding-mode.ts · 15 loc
│  └  rounding.ts · 11 loc · U
├  tests/
│  ├  money.test.ts · 15 loc
│  └  rounding-parity.ts · 15 loc
├  package.json · 19 loc
└  tsconfig.json · 20 loc
~~~

### `references`

Answers from every project loaded in the session, and names how many that was.
A bare count reads as complete when it is not, so the line carries the
denominator and an agent can decide whether to widen.

**Agent's Input**

```yaml
tool: References
workspace: fixtures/ledger
file: packages/money/src/money.ts
position: {"line":12,"character":13}
# answered in under 1s
```

**Response**

~~~text
Money [type] · packages/money/src/money.ts:12:13
37 references · all 9 projects searched · packages/money/tsconfig.json

1-20 of 37 references · pass offset: 20 for the rest

packages/accounts/src/journal.ts
├  1:28  — at module level
├  14:35 — inside constructor
├  31:61 — inside post
└  36:62 — inside post
packages/accounts/src/posting.ts
└  25:49 — inside signedAmount
packages/money/src/index.ts
└  7:8 — at module level
packages/money/src/money.ts
├  27:73 — inside money
├  28:53 — inside money
├  30:43 — inside zero
├  38:27 — inside add
├  38:41 — inside add
├  38:49 — inside add
├  45:31 — inside negate
├  45:39 — inside negate
├  47:31 — inside isZero
└  50:31 — inside format
packages/money/tests/rounding-parity.ts
├  1:15  — at module level
├  9:44  — inside assertRoundingParity
├  9:58  — inside assertRoundingParity
└  15:38 — inside paritySamples
~~~

### `occurrences`

Literal text, grouped by file, with the number of files scanned. The semantic
tools rank what exists, which is useless for confirming a token is gone after a
teardown; a zero here comes with the same scan count, so it means something.

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
text: signedAmount
# answered in under 1s
```

**Response**

~~~text
"signedAmount" occurs 12 times in 7 files · 67 files scanned under the workspace · 1 file of declared build output not scanned.

packages/accounts/src/index.ts:12:39 · export { credit, debit, type Posting, signedAmount } from "./posting.ts";
packages/accounts/src/journal.ts
├  3:39  · import { credit, debit, type Posting, signedAmount } from "./posting.ts";
└  52:12 · .map(signedAmount)
packages/accounts/src/posting.ts:25:14 · export const signedAmount = (posting: Posting): Money => {
packages/reconcile/src/drift.ts
├  4:24  · import { type Posting, signedAmount } from "@ledger/accounts";
└  20:37 · const journalTotal = postings.map(signedAmount).reduce((total, amount) => total + amount);
packages/reconcile/src/matching.ts
├  1:55  · // DELIBERATELY BROKEN — the imports for `money` and `signedAmount` are
└  14:20 · const amount = signedAmount(posting);
packages/reports/src/balance.ts
├  6:3   · signedAmount,
└  34:57 · add(own.get(posting.account) ?? zero(currency), signedAmount(posting)),
packages/rules/src/builtin.ts
├  1:10  · import { signedAmount } from "@ledger/accounts";
└  26:12 · .map(signedAmount)
~~~

### `investigate_code`

Retrieval always returns its nearest neighbours and its top hit always shows as
100%. When nothing retrieved declares anything the question named, the answer
says so and stops rather than expanding relationships around the wrong symbol.

**Agent's Input**

```yaml
tool: Investigate code
workspace: fixtures/ledger
question: where is the retry backoff for failed network requests configured
# answered in under 1s
```

**Response**

~~~text
Search: where is the retry backoff for failed network requests configured

3 matches · relevance is relative to the strongest match · no identifier to anchor on, so these are ranked by meaning alone

=== 1 · packages/importers/src/config.ts:1-7 · relevance 100% ===

Structure: defaultCurrencyCode
Symbol: defaultCurrencyCode [variable] · selection 7:14-7:33 · range 7:14-7:72

1 | import ledgerConfig from "../../../ledger.config.json" with { type: "json" };
2 |
3 | /** The account unmatched statement lines land in until a bookkeeper files them. */
4 | export const suspenseAccount: string = ledgerConfig.suspenseAccount;
5 |
6 | /** The currency a bank export is assumed to use when it does not say. */

=== 2 · packages/accounts/src/account.ts:21-35 · relevance 92% ===

Structure: AccountStore
Symbol: AccountStore [interface] · selection 31:18-31:30 · range 31:1-35:2

21 | export const parentPath = (path: AccountPath): AccountPath | undefined => {
22 |   const at = path.lastIndexOf(":");
23 |   return at === -1 ? undefined : path.slice(0, at);
24 | };
25 |
26 | /** Every ancestor from root to the account itself: `a`, `a:b`, `a:b:c`. */

=== 3 · packages/importers/vite.config.ts:1-9 · relevance 92% ===

Structure: default
Symbol: default [variable] · selection 4:1-9:3

1 | // Importers ship to the bookkeeping portal as a browser bundle; the library
2 | // packages stay unbundled. Output lands in the default `dist` beside this
3 | // config, which the repository commits so the portal deploy needs no build.
4 | export default {
5 |   build: {
6 |     outDir: "dist",

None of these declares anything the question names, so no relationship expansion follows — the matches above are retrieval's nearest neighbours, not an answer. If the concept should exist here, ask again naming an identifier from it; if you are proving absence, occurrences gives the literal zero.
~~~

### `impact`

What a change would touch, by package, with the test share separated and the
unconfirmed part named.

**Agent's Input**

```yaml
tool: Impact
workspace: fixtures/ledger
file: packages/accounts/src/posting.ts
position: {"line":25,"character":14}
# answered in under 1s
```

**Response**

~~~text
Changing signedAmount touches 10 uses in 6 files across 4 packages, in the projects loaded this session. No use sits in a test file.

package             uses  files  tests
packages/accounts      4      3
packages/reports       2      1
packages/reconcile     2      1
packages/rules         2      1
~~~

## Cost

`documentSymbol` for one 286-line file returns 139 nodes, 3 of them real
declarations and the rest nested object properties and anonymous callbacks.
As JSON that is 31,584 characters, 2.9x the source file. The same question here
is 271 characters, from the same engine.

On that monorepo a `references` call is about 150ms warm. The first call after
the server starts pays for building that TypeScript program, which was 2.5s
there. Every answer carries its own elapsed time and request count, so a cold
project is visible rather than inferred.
[Measurements](docs/tool-latency-measurements.md), and
[the same on a large monorepo](docs/kek-monorepo-latency.md).

The tool list is a standing cost in every session: about 15,400 tokens of
schema, measured when there were 35 tools, and there are more now.

## Limits

References stop at the TypeScript project boundary. Projects the session has
not loaded cannot contribute, which is why the answer states how many it
searched and reading a file in another package widens the next one. No other
code-intelligence MCP server examined resolves this either.

Retrieval matches meaning, not text, and will not reliably find an exact
string, error message, or comment. Use `occurrences` or your client's search.

This only does TypeScript, Markdown, and JSON.
[Serena](https://github.com/oraios/serena) handles around 60 languages if you
need that.

Claude Code's `typescript-lsp` plugin is the obvious thing to compare against,
since it wraps the same engine. I ran both in one session against the same
symbols and kept using this one. Those notes, and the same treatment for the
other code-intelligence MCP servers, are in
[the comparison](docs/code-intelligence-mcp-comparison.md).

## Packages

| Package                                                   | Role                                                    |
| :-------------------------------------------------------- | :------------------------------------------------------ |
| [`@type-atlas/mcp`](packages/mcp)                          | the MCP server                                          |
| [`@type-atlas/core`](packages/core)                        | headless code-intelligence API                          |
| [`@type-atlas/language-server`](packages/language-server)  | the Volar-based language server the core package drives |

## Development

```sh
vp install
vp run check
vp run check:distribution
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the change and release process.
