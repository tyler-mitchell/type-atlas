<div align="center">
  <img src="./assets/code-intelligence.svg" alt="Code Intelligence MCP" width="96" height="96">

  # Code Intelligence MCP

  Editor-grade code intelligence for coding agents, powered by Volar.js.
</div>

Code Intelligence MCP exposes Volar language services over the Model Context Protocol. TypeScript supplies project-wide navigation and type information; Markdown and JSON use their native language services for document structure, folding, diagnostics, and other supported operations. Optional [Semble](https://github.com/MinishLab/semble) retrieval connects implementation questions to exact Volar symbols and relationships.

## Features

- Native TypeScript, Markdown, and JSON language-service results through Volar.js
- Automatic project selection and workspace change tracking
- Multiple isolated workspace sessions in one MCP process
- Compact plain-text results with workspace-relative paths
- Exact source ranges suitable for subsequent edits
- Read-only edit proposals applied through the agent's normal patch workflow
- Concept search and structural-similarity retrieval anchored to exact language-server symbols

## Install

Requires Node.js 22.20 or newer. The Semble-backed intelligence tools additionally require [`uv`](https://docs.astral.sh/uv/getting-started/installation/); Semble starts lazily on the first retrieval request.

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
| Discover and investigate code | `search_code`, `search_dependency_code`, `related_code`, `explore_symbol`, `investigate_code` |
| Inspect editor information | `diagnostics`, `inlay_hints` |
| Prepare source changes | `rename_symbol`, `rename_files`, `format_document`, `code_actions` |

`read_file` reads UTF-8 source, Markdown, JSON, and other text files. It accepts one or more files, supports independent ranges per file, and uses native folding when available; files without folding information remain fully readable with stable line numbers. File-scoped semantic tools surface relevant diagnostics without requiring a separate diagnostics request.

`inspect_symbol` accepts either an exact file-local symbol name or a source position. Its default view combines the symbol's type, documentation, declaration range, callers, direct calls, and non-call references while removing facts already represented elsewhere in the same result. Complete source and callable type-definition targets are explicit opt-ins.

`search_code` retrieves code by behavior, concept, or identifier and anchors each result to its enclosing Volar document symbol. `search_dependency_code` searches only the explicitly requested installed packages; its consumer `file` selects the exact package versions visible to that project. `related_code` starts from a known source line and finds structurally similar code. `explore_symbol` combines one exact Volar inspection with related implementations. `investigate_code` preserves Semble's ranked candidate page, expands one exact identifier when present, and otherwise expands only the most specific retrieved symbol sharing the first candidate's Volar declaration ancestry. Similarity remains opt-in. In large monorepos, `scope` can search a workspace-relative subtree through Semble's native repository boundary.

Editing tools ask the language server to compute its native edits and return a Codex patch. The MCP never writes source files; the agent applies the proposal through its normal patch mechanism, preserving its usual review, stale-content rejection, and visible diff.

## Conventions

- `workspace` may be absolute or relative to the MCP process working directory.
- File paths may be absolute or relative to that root.
- Semantic positions use zero-based LSP lines and UTF-16 characters.
- `read_file` ranges and displayed source lines are one-based.
- Workspace intelligence retrieval ranges and displayed source lines are zero-based so their locations can be passed directly to semantic tools.
- Dependency-search ranges and displayed source lines are one-based so they can be passed directly to `read_file`.
- `workspace_symbols` can inspect many project files; prefer `document_symbols` when the file is already known.

## Development

From the repository root:

```sh
pnpm --filter @featuretype/code-intelligence-language-server build
pnpm --filter @featuretype/code-intelligence-mcp build
pnpm --filter @featuretype/code-intelligence-mcp check-types
```

The published package includes the stdio executable, compiled runtime, and presentation assets.
