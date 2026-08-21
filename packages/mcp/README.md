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
`["--yes", "@type-atlas/mcp@latest"]`. Claude Desktop, Windows, and the rest
are in the
[install section](https://github.com/tyler-mitchell/type-atlas#install).
Clients read MCP config at startup, so restart after. `@latest` resolves on
every process start; pin a version if you do not want tool behavior moving
under you.

### Recommended

Installing the server does not change what an agent reaches for. Claude will
assemble whatever its shell allows, chained together, so naming a few commands
to avoid does not hold. Add this to `AGENTS.md` or `CLAUDE.md`:

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

## Output

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

That is captured from the running server by the suite that regression-checks
it. The [repository README](https://github.com/tyler-mitchell/type-atlas#output)
does the same for the other tools, with the token and latency numbers.

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
is written for you.

Apache-2.0 · [github.com/tyler-mitchell/type-atlas](https://github.com/tyler-mitchell/type-atlas)
