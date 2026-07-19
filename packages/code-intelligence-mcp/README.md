<div align="center">
  <img src="./assets/code-intelligence.svg" alt="Code Intelligence MCP" width="96" height="96">

  # Code Intelligence MCP

  Semantic TypeScript navigation for coding agents, powered by Volar.js.
</div>

Code Intelligence MCP exposes editor-grade TypeScript intelligence over the Model Context Protocol. It is designed for agents that need exact definitions, references, call relationships, types, diagnostics, and source ranges while working in real repositories.

## Features

- Native Volar.js and TypeScript language-service results
- Automatic project selection and workspace change tracking
- Multiple isolated workspace sessions in one MCP process
- Compact plain-text results with workspace-relative paths
- Exact source ranges suitable for subsequent edits
- Read-only edit proposals applied through the agent's normal patch workflow

## Install

Requires Node.js 22.20 or newer.

Add the server to your MCP client using the package executable:

```toml
[mcp_servers.code_intelligence]
command = "npx"
args = ["-y", "@featuretype/code-intelligence-mcp"]
```

The server communicates over stdio, negotiates the current MCP protocol with v2 clients, and remains compatible with 2025-era clients. No separate daemon or manual change notification is required.

## Tools

| Workflow | Tools |
| --- | --- |
| Read and orient | `read_file`, `document_symbols`, `workspace_symbols`, `project_config` |
| Inspect types and calls | `inspect_symbol`, `hover`, `signature_help`, `completions`, `callers`, `callees` |
| Navigate declarations | `definitions`, `type_definitions`, `implementations` |
| Find usage | `references`, `file_references`, `document_highlights` |
| Inspect editor information | `diagnostics`, `inlay_hints` |
| Prepare source changes | `rename_symbol`, `rename_files`, `format_document`, `code_actions` |

`read_file` accepts one or more files, supports independent ranges per file, and folds large implementation regions by default. File-scoped semantic tools surface relevant diagnostics without requiring a separate diagnostics request.

`inspect_symbol` accepts either an exact file-local symbol name or a source position. Its default view combines the symbol's type, documentation, declaration range, callers, direct calls, and non-call references while removing facts already represented elsewhere in the same result. Complete source and callable type-definition targets are explicit opt-ins.

Editing tools ask the language server to compute its native edits and return a Codex patch. The MCP never writes source files; the agent applies the proposal through its normal patch mechanism, preserving its usual review, stale-content rejection, and visible diff.

## Conventions

- `workspace` is an absolute workspace root.
- File paths may be absolute or relative to that root.
- Semantic positions use zero-based LSP lines and UTF-16 characters.
- `read_file` ranges and displayed source lines are one-based.
- `workspace_symbols` can inspect many project files; prefer `document_symbols` when the file is already known.

## Development

From the repository root:

```sh
pnpm --filter @featuretype/code-intelligence-language-server build
pnpm --filter @featuretype/code-intelligence-mcp build
pnpm --filter @featuretype/code-intelligence-mcp check-types
```

The published package includes the stdio executable, compiled runtime, and presentation assets.
