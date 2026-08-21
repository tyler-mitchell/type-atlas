<!-- Generated from README.mdoc by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->
# Type Atlas

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

Paste this to your coding agent:

```text
Set up the Type Atlas MCP server.

Register it: `codex mcp add type-atlas -- npx --yes @type-atlas/mcp@latest`
for Codex, or `claude mcp add --scope user type-atlas -- npx --yes
@type-atlas/mcp@latest` for Claude Code.

Then append this to AGENTS.md or CLAUDE.md, creating the file if needed:

  Type Atlas MCP is the required tool for code navigation, reading, and
  diagnostics in TypeScript and JavaScript. This is not a preference. Do
  not use grep, glob, find, or plain file reads on code. The only valid
  fallbacks are a server that is down, a call that errored, or a file
  that is neither TS nor JS.

Then tell me to restart the client so it loads the server.
```

The rule is there because installing the server does not change what an agent
reaches for. Claude in particular goes back to grep and whole-file reads and
produces a fresh justification every time, so the wording has to say required
and name the only exceptions.

<details>
<summary>Codex, by hand</summary>

```sh
codex mcp add type-atlas -- npx --yes @type-atlas/mcp@latest
```

Writes to `~/.codex/config.toml`, so every repository Codex opens has it.
`codex mcp list` confirms it, `codex mcp remove type-atlas` undoes it.

</details>

<details>
<summary>Claude Code, by hand</summary>

```sh
claude mcp add --scope user type-atlas -- npx --yes @type-atlas/mcp@latest
```

`--scope user` covers every repository. `--scope project` writes a checked-in
`.mcp.json` your collaborators share, `--scope local` is one repository on one
machine.

Claude Desktop keeps a separate server list, so this does not reach it. Add it
under `mcpServers` in `claude_desktop_config.json`, at
`~/Library/Application Support/Claude/` on macOS or `%APPDATA%\Claude\` on
Windows:

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

Claude Desktop starts servers without your shell `PATH`, so an nvm or Homebrew
runtime is not found by name and the server fails to start. Use the absolute
path from `which npx` when that happens.

</details>

<details>
<summary>Other clients</summary>

VS Code:

```sh
code --add-mcp '{"name":"type-atlas","command":"npx","args":["--yes","@type-atlas/mcp@latest"]}'
```

Anything else that reads the standard shape:

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

Clients that cannot launch the `npx.cmd` shim need `cmd`: `"command": "cmd"`
with `"args": ["/c", "npx", "--yes", "@type-atlas/mcp@latest"]`, or
`codex mcp add type-atlas -- cmd /c npx --yes @type-atlas/mcp@latest`.

</details>

Clients read MCP config at startup, so restart after. `@latest` resolves on
every process start; pin a version if you do not want tool behavior moving
under you.

`search_code`, `related_code`, `investigate_code`, and `search_dependency_code`
run a semantic index through `uvx` and need
[uv](https://docs.astral.sh/uv/getting-started/installation/). Without it those
four report that uv is missing, `explore_symbol` drops its related-code
section, and the rest is unaffected.

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

Bodies fold to signatures by default. Overloads survive folding, bodies come
back with `fold: false`, and the argument takes an array so several files land
in one call.

**Agent's Input**

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/accounts/src/journal.ts"]
```

**Response**

~~~text
1 file · 52 lines · 22 folded to signatures, pass fold: false for the bodies

=== packages/accounts/src/journal.ts · 73 lines ===

 1 | import { add, isZero, type Money, zero } from "@ledger/money";
 2 | import type { AccountPath } from "./account.ts";
 3 | import { credit, debit, type Posting, signedAmount } from "./posting.ts";
 4 |
 5 | /** A balanced set of postings, recorded together or not at all. */
 6 | export interface Entry<TMeta = undefined> {
 7 |   readonly recordedAt: Date;
 8 |   readonly description: string;
 9 |   readonly postings: readonly Posting[];
10 |   readonly meta: TMeta;
11 | }
12 |
13 | export class UnbalancedEntryError extends Error {
14 |   constructor(readonly imbalance: Money) {
15 |     super(`Entry does not balance: off by ${imbalance.minorUnits} minor units`);
16 |   }
17 | }
18 |
19 | /**
20 |  * An append-only journal of balanced entries. `TMeta` carries whatever a
21 |  * consumer attaches to each entry — an import batch id, an approval trail —
22 |  * without the journal knowing its shape.
23 |  */
24 | export class Journal<TMeta = undefined> {
25 |   private readonly entries: Entry<TMeta>[] = [];
26 |
27 |   /** Record a prepared entry, or build the common two-posting transfer. */
28 |   post(entry: Entry<TMeta>): Entry<TMeta>;
29 |   post(
30 |     description: string,
31 |     transfer: { from: AccountPath; to: AccountPath; amount: Money },
32 |     meta: TMeta,
33 |   ): Entry<TMeta>;
34 |   post(
   |     ... 35-56 folded
57 |   }
58 |
59 |   /** Entries touching an account, oldest first. */
60 |   history(account: AccountPath): readonly Entry<TMeta>[] {
61 |     return this.entries.filter((entry) =>
62 |       entry.postings.some((posting) => posting.account === account),
63 |     );
64 |   }
65 |
66 |   get length(): number {
67 |     return this.entries.length;
68 |   }
69 |
70 |   [Symbol.iterator](): Iterator<Entry<TMeta>> {
71 |     return this.entries[Symbol.iterator]();
72 |   }
73 | }
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

Literal text, with the number of files scanned. The semantic tools rank what
exists, which is useless for confirming a token is gone after a teardown.

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
text: quantumFlux
```

**Response**

~~~text
Nothing under the workspace contains "quantumFlux" · 67 files scanned · 1 file of declared build output not scanned — scan a generated directory directly to include it. This is a literal answer: the exact text does not occur in what was scanned, which is the proof a semantic search cannot give.
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
