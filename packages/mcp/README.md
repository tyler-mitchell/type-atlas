<!-- Generated from packages/mcp/README.mdoc by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->
<div align="center">

<img src="https://raw.githubusercontent.com/tyler-mitchell/type-atlas/main/packages/mcp/assets/type-atlas.png" width="96" alt="" />

# Type Atlas

**Editor-grade TypeScript, Markdown, and JSON intelligence for coding agents,**<br />
**shaped for a context window instead of a screen.**

</div>

Type Atlas runs locally over stdio and answers from the TypeScript project
that owns each file, so definitions, references, diagnostics, and source
ranges reflect the repository an agent is actually changing. The language
intelligence is not the hard part — every LSP bridge has that. The hard part
is deciding what an agent does not need to see.

## Install

```sh
codex mcp add type-atlas -- npx --yes @type-atlas/mcp@latest
```

```sh
claude mcp add --scope user type-atlas -- npx --yes @type-atlas/mcp@latest
```

For Claude Desktop, VS Code, native Windows, and generic MCP client setup, see
the [installation guide](https://github.com/tyler-mitchell/type-atlas#install).

Requires Node.js 22.20 or newer; no global installation. `@latest` starts the
current release each time the MCP process starts — pin an exact version when
reproducible tool behavior matters more than automatic upgrades.

Navigation, diagnostics, code actions, and reads work with Node.js alone. The
retrieval tools `search_code`, `related_code`, `investigate_code`, and
`search_dependency_code` additionally require
[uv](https://docs.astral.sh/uv/getting-started/installation/), which supplies
the `uvx` command used to run the semantic index. Without it those four tools
report that `uvx` is missing, and `explore_symbol` returns its language-server
inspection without the related-code section.

## What an answer looks like

Captured from the running server against a realistic example monorepo by the
scenario suite that regression-checks every response —
[none is written by hand](https://github.com/tyler-mitchell/type-atlas#how-the-examples-stay-honest):

```yaml
tool: Document symbols
workspace: fixtures/ledger
file: packages/reconcile/src/drift.ts
```

~~~text
=== packages/reconcile/src/drift.ts · 3 top-level symbols ===

drift [variable] 19:14-19:19 · range 19:14-22:2
StatementLine [interface] 8:18-8:31 · range 8:1-12:2
statementTotal [variable] 15:14-15:28 · range 15:14-16:56

4 problems in packages/reconcile/src/drift.ts
~~~

An editor shows diagnostics in the gutter continuously, so a human cannot miss
them. An agent only learns what it asks about — so a file's symbols arrive
with its diagnostics attached, unasked. The
[repository README](https://github.com/tyler-mitchell/type-atlas#what-an-answer-looks-like)
gives the other core tools the same treatment.

## The tools

| Question                         | Tools                                                                                                                                                                              |
| :------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand a symbol, in one call | `inspect_symbol` · `explore_symbol`                                                                                                                                                |
| Navigate a relationship in full  | `definitions` · `type_definitions` · `implementations` · `callers` · `callees` · `references` · `file_references` · `document_highlights` · `document_symbols` · `workspace_symbols` |
| Read economically                | `read_file` · `list_files`                                                                                                                                                         |
| Stay correct while editing       | `diagnostics` · `code_actions` · `organize_imports` · `add_missing_imports` · `remove_unused_code` · `fix_all` · `format_document` · `rename_symbol` · `rename_files`              |
| Understand a dependency          | `list_module_exports` · `search_dependency_code`                                                                                                                                   |
| Find code by meaning             | `search_code` · `related_code` · `investigate_code`                                                                                                                                |

Every response uses workspace-relative paths and one-based coordinates.
Editing tools return reviewable patches; nothing is applied silently. One
Volar-composed language server answers TypeScript, Markdown, and JSON from a
single project model.

---

<div align="center">
<sub>Apache-2.0 · <a href="https://github.com/tyler-mitchell/type-atlas">github.com/tyler-mitchell/type-atlas</a></sub>
</div>
