<!-- Generated from packages/mcp/README.mdoc by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->
<div align="center">

<img src="https://raw.githubusercontent.com/tyler-mitchell/type-atlas/main/packages/mcp/assets/type-atlas.png" width="96" alt="" />

# Type Atlas

</div>

Type Atlas is an MCP server for code intelligence. A Volar language server
answers from the TypeScript project that owns each file, so definitions,
references, types, diagnostics, and ranges match what an editor shows.

Responses are written for a context window instead of a screen. A file outline
is the declarations in it, not every nested callback. A read folds bodies to
signatures. `inspect_symbol` composes eight language-server requests into one
answer. Every answer states the scope it covered and what it cost.

I use it every day, on a large monorepo maintained almost entirely by agents.

TypeScript, Markdown, and JSON. Node 22.20 or newer.

## Install

```sh
codex mcp add type-atlas -- npx --yes @type-atlas/mcp@latest

claude mcp add --scope user type-atlas -- npx --yes @type-atlas/mcp@latest

code --add-mcp '{"name":"type-atlas","command":"npx","args":["--yes","@type-atlas/mcp@latest"]}'
```

Any other client takes the standard `mcpServers` shape with `npx` and
`["--yes", "@type-atlas/mcp@latest"]`. Windows and the rest are in the
[install section](https://github.com/tyler-mitchell/type-atlas#install).
Clients read MCP config at startup, so restart after. `@latest` resolves on
every process start; pin a version if you do not want tool behavior moving
under you.

### Recommended

Installing the server does not change what an agent reaches for. Some agents,
Claude among them, will assemble whatever their shell allows, chained together,
so naming a few commands to avoid does not hold. Add this to `AGENTS.md` or
`CLAUDE.md`:

> Type Atlas MCP is the required tool for reading and navigating code in
> TypeScript and JavaScript. This is not a preference. No shell command is an
> acceptable substitute, whatever it is composed of, and neither is a plain
> file read. The only valid fallbacks are a server that is down, a call that
> errored, or a file that is neither TS nor JS.

`search_code`, `related_code`, `investigate_code`, and `search_dependency_code`
run a semantic index through `uvx` and need
[uv](https://docs.astral.sh/uv/getting-started/installation/). Without it those
four report that uv is missing, `explore_symbol` drops its related-code
section, and the rest is unaffected.

## Tool call results

Paths are workspace-relative, coordinates are one-based, so a location in one
answer is valid input to the next call. Editing tools return patches; nothing
is written for you.

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

That is captured from the running server by the suite that regression-checks
it. The [repository README](https://github.com/tyler-mitchell/type-atlas#tool-call-results)
does the same for the other tools.

Apache-2.0 · [github.com/tyler-mitchell/type-atlas](https://github.com/tyler-mitchell/type-atlas)
