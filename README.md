# Type Atlas

**Editor-grade TypeScript, Markdown, and JSON intelligence for coding agents —
shaped for a context window instead of a screen.**

Type Atlas runs locally over stdio and answers from the TypeScript project that
owns each file, so definitions, references, diagnostics, and source ranges
reflect the repository an agent is actually changing.

The language intelligence is not the hard part. Every LSP bridge has that. The
hard part is deciding what an agent does not need to see.

## Why it exists

Ask a language server what is in one 286-line file and it returns **139 symbol
nodes** — 3 real declarations and 136 nested object properties and anonymous
callbacks. Passed through as LSP JSON that is 31,584 characters, **2.9× larger
than the source file it describes**. Formatted as an indented tree it is still
~4,900.

Type Atlas answers the same question, from the same TypeScript engine, in **271
characters**:

```
Symbols (3 top-level) · packages/mcp/src/dependency-search.ts
createDependencySearch [variable] selection 38:13-38:35; body 38:13-285:3
DependencySearchResult [variable] selection 12:5-12:27; body 12:0-29:6
queryMatchCount [variable] selection 31:6-31:21; body 31:6-36:51
```

That is the product.

## What that buys you

**One call instead of seven.** `inspect_symbol` composes eight language-server
requests — hover, definitions, type definitions, implementations, callers,
calls, references, project scope — and reports references as the _residual_
after callers and definitions are accounted for. Measured against running those
tools separately: **4× fewer characters and 7× fewer round trips**. Round trips
are the expensive part; each one is a model turn.

**Errors you forgot to check for.** Ask for a file's symbols and you also get its
diagnostics, unasked:

<!-- scenario:document_symbols/broken-file-answers-with-diagnostics -->
```
=== packages/reconcile/src/drift.ts · 3 top-level symbols ===

drift [variable] 19:14-19:19 · range 19:14-22:2
StatementLine [interface] 8:18-8:31 · range 8:1-12:2
statementTotal [variable] 15:14-15:28 · range 15:14-16:56

4 problems in packages/reconcile/src/drift.ts
```
<!-- /scenario -->

That response is not written by hand: it is [captured](packages/mcp/test/scenarios/)
from the real server against a [realistic fixture monorepo](fixtures/ledger/),
regression-checked, and embedded here by the same pipeline — what you read is
what the tool answered.

An editor shows diagnostics in the gutter continuously, so a human cannot miss
them. An agent only learns what it asks about — and an agent that just edited
code often does not think to ask.

**An answer that tells you what it does not know.** Reference results state the
project they came from:

```
Scope: project only · packages/core/tsconfig.json
```

In a multi-project workspace that is a scoped answer, not a complete audit, and
Type Atlas says so. A silent partial answer is the worst failure in this
category, because the agent cannot detect it.

**One process for source, docs, and config.** Volar composes TypeScript,
Markdown, and JSON services over a single project model, so **one** language
server answers all three. Not one process per language, not one server to
configure per file type.

## Honest comparison

Type Atlas is not the most capable code-intelligence MCP server, and the
comparisons say so with receipts — every competitor examined from source,
including where they win, and a list of their ideas worth stealing.

- [TypeScript field comparison](docs/typescript-code-intelligence-comparison.md)
  — the closest peers, judged on monorepo behaviour
- [Broader comparison](docs/code-intelligence-mcp-comparison.md) — polyglot
  toolkits and generic LSP bridges

Across eight tools examined, **none resolves references across package
boundaries**, including this one. Type Atlas is the only one that tells you when
an answer is scoped.

Pick something else if:

- **you are not in a TypeScript codebase** — [Serena](https://github.com/oraios/serena)
  covers ~60 languages and is excellent;
- **you want simulation sessions, build runners, or cross-repo analysis** —
  [agent-lsp](https://github.com/blackwell-systems/agent-lsp) has them;
- **you want a thin, auditable 1:1 LSP bridge** —
  [mcpls](https://github.com/bug-ops/mcpls) is exactly that.

Known limits, stated up front: references stop at the TypeScript project
boundary, so a monorepo-wide usage audit needs a text search too; the retrieval
tools match meaning rather than text and will not find an exact string; and the
tool surface costs ~15k tokens of schema to describe.

## Install

Type Atlas requires Node.js 22.20 or newer. No global package installation is
required.

Navigation, diagnostics, code actions, and reads work with Node.js alone. The
retrieval tools `search_code`, `related_code`, `investigate_code`, and
`search_dependency_code` additionally require [uv](https://docs.astral.sh/uv/getting-started/installation/),
which supplies the `uvx` command used to run the semantic index. Without it
those four tools report that `uvx` is missing, and `explore_symbol` returns its
language-server inspection without the related-code section.

### Codex

```sh
codex mcp add type-atlas -- npx --yes @type-atlas/mcp@latest
```

### Claude Code

```sh
claude mcp add --scope user type-atlas -- npx --yes @type-atlas/mcp@latest
```

`--scope user` installs Type Atlas for every repository. Use `--scope project`
to write a checked-in `.mcp.json` that your collaborators share, or
`--scope local` for one repository on one machine.

### Claude Desktop

Claude Desktop keeps its own server list, so installing through the Claude Code
CLI does not add Type Atlas to Claude Desktop, and the reverse is also true. Add
it under `mcpServers` in `claude_desktop_config.json`, at
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

Claude Desktop starts servers without your shell's `PATH`, so a runtime
installed by nvm, Homebrew, or another version manager is not found by name and
the server fails to start. Give the absolute path when that happens:

```json
{
  "mcpServers": {
    "type-atlas": {
      "command": "/opt/homebrew/bin/npx",
      "args": ["--yes", "@type-atlas/mcp@latest"]
    }
  }
}
```

`which npx` prints the path to use.

### VS Code

```sh
code --add-mcp '{"name":"type-atlas","command":"npx","args":["--yes","@type-atlas/mcp@latest"]}'
```

### Other MCP clients

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

### Native Windows

Clients that cannot launch the `npx.cmd` shim directly should invoke it through
`cmd`:

```powershell
codex mcp add type-atlas -- cmd /c npx --yes @type-atlas/mcp@latest
claude mcp add --scope user type-atlas -- cmd /c npx --yes @type-atlas/mcp@latest
```

For JSON configuration, use `"command": "cmd"` and
`"args": ["/c", "npx", "--yes", "@type-atlas/mcp@latest"]`.

Restart your MCP client after changing its configuration; clients load MCP
servers at startup, so a newly added server appears only in a new session.
Configurations using
`@latest` start the current npm release; pin an exact version when reproducible
tool behavior is more important than automatic upgrades.

## What agents can do

**Understand a symbol** — `inspect_symbol` and `explore_symbol` compose the
whole picture in one call. Start here; the rest are for when you need one
relationship in full.

**Navigate** — `definitions`, `type_definitions`, `implementations`, `callers`,
`callees`, `references`, `file_references`, `document_highlights`,
`document_symbols`, `workspace_symbols`.

**Read economically** — `read_file` folds function bodies to signatures by
default, takes line ranges, and batches many files into one call. `list_files`
gives bounded, gitignore-aware structure.

**Stay correct while editing** — `diagnostics` scoped to the real TypeScript
project; `code_actions`, `organize_imports`, `add_missing_imports`,
`remove_unused_code`, `fix_all`, `format_document`, `rename_symbol`, and
`rename_files` all returned as **reviewable patches** rather than applied
silently.

**Understand dependencies** — `list_module_exports` inspects a package's real
importable surface from the importing file's resolution, and
`search_dependency_code` searches installed package source without indexing all
of `node_modules`.

**Find by meaning** — `search_code`, `related_code`, and `investigate_code`
match behavior and concepts, then anchor each hit to an exact language-server
symbol.

Every response uses workspace-relative paths and one-based coordinates, so
locations can be used directly. Token-expanding detail is opt-in throughout.

The server also ships **usage instructions in the MCP handshake**, so guidance on
which tool to reach for persists in an agent's context even when tool schemas do
not.

## Packages

- [`@type-atlas/mcp`](packages/mcp) is the installable MCP server.
- [`@type-atlas/core`](packages/core) is the headless code-intelligence API.
- [`@type-atlas/language-server`](packages/language-server) is the Volar-based
  language server used by the core package.

## Development

```sh
pnpm install
pnpm check
pnpm check:distribution
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the change and release process.

## License

Apache-2.0
