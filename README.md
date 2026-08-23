<!-- Generated from README.mdoc by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->
<p align="center">
  <img src="packages/mcp/assets/type-atlas-cover.png" width="100%" alt="Type Atlas — code intelligence for TypeScript" />
</p>

<div align="center">

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

A client that starts servers without your shell `PATH` will not find `npx` by
name; give the absolute path from `which npx` when that happens. On Windows, a
client that cannot launch the `npx.cmd` shim needs `"command": "cmd"` with
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

Installing the server does not change what an agent reaches for. Some agents,
Claude among them, will assemble whatever their shell allows, chained together,
and produce a fresh justification each time, so naming a few commands to avoid
does not hold. The instruction has to rule out the whole category and name the
exceptions. Add this to `AGENTS.md` or `CLAUDE.md`:

> Type Atlas MCP is the required tool for reading and navigating code in
> TypeScript and JavaScript. This is not a preference. No shell command is an
> acceptable substitute, whatever it is composed of, and neither is a plain
> file read. The only valid fallbacks are a server that is down, a call that
> errored, or a file that is neither TS nor JS.

### `--require-intent`

This opt-in flag requires one decision sentence for broad exploration tools
such as repository search and workspace symbols. Targeted reads and semantic
lookups stay unaffected, and intent is never echoed into tool responses.

## Tool call results

Paths are workspace-relative, coordinates are one-based, so a location in one
answer is valid input to the next call. Editing tools return patches; nothing
is written for you.

Everything below is captured from the running server against
[`fixtures/ledger`](fixtures/ledger/) by the
[scenario suite](packages/mcp/test/scenarios/), which replays the same calls
and fails on drift. Nothing here is hand-written, and changing what a tool
answers changes this file in the same commit. The source is
[`README.mdoc`](README.mdoc). Every tool has a page with more cases in
[docs/tools](docs/tools/).

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

# answered in 57ms
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

# answered in 49ms
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

## Mentions that are not calls (4 of 9 references · 5 relevant projects searched)

packages/accounts/tests/journal.test.ts:3:25-3:32:  import { credit, debit, Journal, UnbalancedEntryError } from "../src/index.ts";
packages/accounts/src/index.ts:11:22-11:29:  export { type Entry, Journal, UnbalancedEntryError } from "./journal.ts";
packages/reports/src/balance.ts:4:8-4:15:  type Journal,
packages/importers/src/csv.ts:1:10-1:17:  import { Journal, type Entry, credit, debit, type AccountPath } from "@ledger/accounts";

references lists all 9, with paging.
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

# answered in 7ms
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

### `occurrences`

Literal text, grouped by file, with the number of files scanned. The semantic
tools rank what exists, which is useless for confirming a token is gone after a
teardown; a zero here comes with the same scan count, so it means something.

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
text: signedAmount

# answered in 12ms
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

### `search_code`

Finds code by what it does, for when you cannot guess what it is called. Hits
come back in rank order, each carrying the file range it came from, so the
next call has somewhere to go. Live answers also carry a relevance percentage
per hit; it is left out below because the embedding scores behind it differ
between machines and these cases are compared byte for byte.

**Agent's Input**

```yaml
tool: Search code
workspace: fixtures/ledger
query: walking an account up through each of its ancestor accounts
snippetLines: 6

# answered in 20ms
```

**Response**

~~~text
Search: walking an account up through each of its ancestor accounts

5 matches · no identifier to anchor on, so these are ranked by meaning alone

=== 1 · packages/accounts/src/account.ts:21-35 ===

Structure: parentPath
Symbol: parentPath [variable] · selection 21:14-21:24 · range 21:14-24:2

21 | export const parentPath = (path: AccountPath): AccountPath | undefined => {
22 |   const at = path.lastIndexOf(":");
23 |   return at === -1 ? undefined : path.slice(0, at);
24 | };
25 |
26 | /** Every ancestor from root to the account itself: `a`, `a:b`, `a:b:c`. */

=== 2 · packages/reports/src/balance.ts:1-23 ===

Structure: BalanceLine
Symbol: BalanceLine [interface] · selection 11:18-11:29 · range 11:1-16:2

1 | import {
2 |   type AccountPath,
3 |   type Entry,
4 |   type Journal,
5 |   lineage,
6 |   signedAmount,

=== 3 · packages/accounts/src/journal.ts:59-73 ===

Structure: Journal > history
Symbol: history [method] · selection 60:3-60:10 · range 60:3-64:4

59 |   /** Entries touching an account, oldest first. */
60 |   history(account: AccountPath): readonly Entry<TMeta>[] {
61 |     return this.entries.filter((entry) =>
62 |       entry.postings.some((posting) => posting.account === account),
63 |     );
64 |   }

=== 4 · packages/reports/src/statement.ts:1-11 ===

Structure: statementLine
Symbol: statementLine [variable] · selection 8:14-8:27 · range 8:14-11:2

1 | import { type Account, normalBalance } from "@ledger/accounts";
2 | import { format, type Money, negate } from "@ledger/money";
3 |
4 | /**
5 |  * One rendered statement line. The sign follows the account's normal side:
6 |  * a liability holding a credit balance reads as positive on its statement.

=== 5 · packages/accounts/src/posting.ts:1-24 ===

Structure: credit
Symbol: credit [variable] · selection 18:14-18:20 · range 18:14-22:3

1 | import { type Money, negate } from "@ledger/money";
2 | import type { AccountPath } from "./account.ts";
3 |
4 | /**
5 |  * One side of a journal entry. The discriminant is the bookkeeping side, so
6 |  * every consumer's switch is checked for exhaustiveness by the compiler.
~~~

### `diagnostics`

The compiler's own whole-program check, per project, not a per-file pass. An
edit in one file usually breaks a different one, and this is the call that
finds that file.

**Agent's Input**

```yaml
tool: Diagnostics
workspace: fixtures/ledger
file: packages/reconcile/src/drift.ts

# answered in 23ms
```

**Response**

~~~text
packages/reconcile/src/drift.ts · 4 problems · packages/reconcile/tsconfig.json

=== packages/reconcile/src/drift.ts ===

error ts(2365) 16:33-16:52 — inside lines.reduce() callback
  Operator '+' cannot be applied to types 'number' and 'Money'.
   14 | /** Statement total, computed by someone who forgot Money is not a number.…
   15 | export const statementTotal = (lines: readonly StatementLine[]): number =>
   16 |   lines.reduce((total, line) => total + line.amount, 0);
      |                                 ^^^^^^^^^^^^^^^^^^^
   17 |
   18 | /** Drift between the journal's view and the bank's view of one day. */

error ts(2365) 20:77-20:91 — inside reduce() callback
  Operator '+' cannot be applied to types 'import("packages/money/src/money").Money' and 'import("packages/money/src/money").Money'.
   18 | /** Drift between the journal's view and the bank's view of one day. */
   19 | export const drift = (postings: readonly Posting[], statement: readonly St…
   20 |   const journalTotal = postings.map(signedAmount).reduce((total, amount) =…
      |                                                                             ^^^^^^^^^^^^^^
   21 |   return format(money(journalTotal - statementTotal(statement), "usd"));
   22 | };

error ts(2345) 21:65-21:70 — inside drift
  Argument of type '"usd"' is not assignable to parameter of type 'Currency'.
   19 | export const drift = (postings: readonly Posting[], statement: readonly St…
   20 |   const journalTotal = postings.map(signedAmount).reduce((total, amount) =…
   21 |   return format(money(journalTotal - statementTotal(statement), "usd"));
      |                                                                 ^^^^^
   22 | };
   23 |

error ts(2362) 21:23-21:35 — inside drift
  The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.
   19 | export const drift = (postings: readonly Posting[], statement: readonly St…
   20 |   const journalTotal = postings.map(signedAmount).reduce((total, amount) =…
   21 |   return format(money(journalTotal - statementTotal(statement), "usd"));
      |                       ^^^^^^^^^^^^
   22 | };
   23 |
~~~

### `workspace_symbols`

Find a declaration by name across every project the session has loaded, when
you know roughly what it is called and nothing about where it lives.

**Agent's Input**

```yaml
tool: Workspace symbols
workspace: fixtures/ledger
file: packages/importers/src/statement-parser.ts
query: Parser

# answered in 100ms
```

**Response**

~~~text
3 symbols matching Parser · 8 projects loaded · packages/importers/tsconfig.json

CsvStatementParser [class] · packages/importers/src/statement-parser.ts:25:1-35:2
FixedWidthStatementParser [class] · packages/importers/src/statement-parser.ts:41:1-64:2
StatementParser [class] · packages/importers/src/statement-parser.ts:7:1-23:2
~~~

### `file_references`

Who imports this module. The module-level question, answered without picking a
symbol inside it first.

**Agent's Input**

```yaml
tool: File references
workspace: fixtures/ledger
file: packages/money/src/money.ts

# answered in 134ms
```

**Response**

~~~text
packages/money/src/money.ts · referenced from 90 places · 6 relevant projects searched · packages/money/tsconfig.json

1-20 of 90 places · pass offset: 20 for the rest

packages/accounts/src/journal.ts
├  1:10  — at module level
└  53:15 — inside post
packages/money/src/index.ts
├  3:3 — at module level
├  4:3 — at module level
└  5:3 — at module level
packages/money/tests/money.test.ts
├  2:10  — at module level
├  2:15  — at module level
├  2:38  — at module level
├  5:10  — inside test("adds amounts of one currency exactly") callback
├  9:16  — inside expect() callback
├  9:67  — inside test("refuses to combine currencies") callback
├  13:10 — inside test("formats major and minor units per currency") callback
└  14:10 — inside test("formats major and minor units per currency") callback
packages/reports/src/balance.ts
├  8:10  — at module level
├  34:9  — inside balancesAsOf
└  41:28 — inside balancesAsOf
packages/reports/src/statement.ts
├  2:10  — at module level
└  10:40 — inside statementLine
packages/rules/src/builtin.ts
├  2:10  — at module level
└  28:58 — inside closedPeriodsBalance
~~~

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
