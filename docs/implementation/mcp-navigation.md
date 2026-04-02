# MCP Navigation Surface

## Purpose

This document describes the current agent-facing navigation surface exposed by
FeatureType MCP.

It is intentionally narrower than the architecture document:

- this file covers navigation tools, output shape, and default usage patterns
- `docs/implementation/mcp-architecture.md` covers runtime structure,
  ownership, and system boundaries
- `docs/implementation/mcp-monorepo-navigation-methodology.md` captures the
  practical large-monorepo workflow validated against gitdrops

## Navigation Design Rules

The current navigation surface follows these rules:

- canonical semantic truth comes from the FeatureType language server
- compact orientation should come before heavy full-file output
- composite answers are preferred when they remove multi-call tool thrash
- rich inspection tools should stay text-first unless structured output is both
  compact and decision-useful
- navigation output should optimize for implementation usefulness, not raw LSP
  completeness

## Current Navigation Tools

### Orientation

`get_document_symbols`

- returns a compact outline by default instead of a raw full symbol tree
- supports `query`, `maxDepth`, and `maxItems`
- is intended for quick file orientation, not exhaustive symbol dumping

### Cross-File Discovery

`search_workspace_symbols`

- forwards Volar's built-in `workspace/symbol` request through the canonical
  session layer
- searches symbol names across the attached project graph without re-scanning
  files inside MCP
- returns native-style workspace symbols instead of a custom MCP-only symbol
  record format
- is intended for “I know the name but not the file” workflows
- is the preferred fallback when import-site `get_definition` stops on a local
  alias or barrel
- bootstraps one workspace document when needed because raw Volar
  `workspace/symbol` requests can return no results before any document has been
  opened

### Composite Inspection

`inspect_symbol`

- accepts either `line` / `col` or a `query`
- combines hover or type information, signature help, definition, type
  definition, implementations, references, and a small member summary when
  available
- is the preferred tool when the question is “what is this thing?” rather than
  “show me one raw protocol response”

### Primitive Navigation

These tools remain available for focused follow-up work:

- `get_definition`
- `get_type_definition`
- `get_implementations`
- `get_references`
- `get_document_highlights`
- `get_file_references`
- `get_call_hierarchy`
- `get_signature`
- `get_type_at`
- `get_hover`

They are most useful when a composite inspection already narrowed the target and
one specific view is needed next.

### Refactor Planning

These tools are thin wrappers over built-in rename and file-rename support:

- `prepare_rename`
- `get_rename_edits`
- `get_file_rename_edits`

They are intended for proving refactor blast radius before edits are made.

### Diagnostic Context

These tools are navigation-adjacent because they help recover local context:

- `get_diagnostics`
- `get_code_actions`
- `get_enriched_file`

`get_enriched_file` is intentionally expensive and should be used only when a
full annotated file view is the right proof lane.

## Default Navigation Workflow

The current recommended usage pattern is:

1. if the file is unknown, locate it with `search_workspace_symbols`
2. orient with `get_document_symbols`
3. inspect with `inspect_symbol`
4. if value-level definition is not enough, use `get_type_definition` or
   `get_implementations`
5. use `get_document_highlights`, `get_file_references`, or
   `get_call_hierarchy` for local read-tracing, module tracing, or call
   tracing
6. use `prepare_rename`, `get_rename_edits`, or `get_file_rename_edits` before
   broad semantic refactors
7. use `get_signature`, `get_type_at`, or `get_hover` for call-site or API
   detail
8. use `get_enriched_file` only when line-by-line diagnostic context is worth
   the token cost

This keeps routine navigation compact while preserving access to detailed views
when they are truly needed.

This keeps agent validation unblocked even while other Codex threads are still
using the currently bound desktop MCP session.

## Output Constraints

The navigation surface is intentionally opinionated about output size:

- `get_document_symbols` defaults to a filtered outline
- `inspect_symbol` limits how many references are shown by default
- rich detail tools return text-first responses to avoid duplicate heavy JSON
- compact structured output belongs on stateful administrative tools, not on
  every navigation response

## Non-Goals

The current navigation surface is not trying to be:

- a generic code graph platform
- a second semantic engine beside the language server
- a custom workspace-symbol indexer or file-scanning graph
- a raw LSP dump surface for every protocol shape
- a replacement for broader discovery or prior-art research documents

## Current Gaps

The current surface still has room to improve.

Notable open gaps:

- no import-origin or export-chain tracing tool exists yet
- no dedicated module-export exploration tool exists yet
- references are not yet summarized or grouped by file
- semantic tokens and inlay hints are not yet exposed even though Volar can
  provide them
- unsaved buffer state is not modeled
- `get_enriched_file` can still be expensive on large files

## Completion Standard For Navigation Changes

A navigation change is only successful when:

- it uses the canonical language-server path
- it lowers the number of tool calls or the token cost of common navigation work
- it improves implementation-time usefulness rather than protocol completeness
- it does not reintroduce a second semantic owner
