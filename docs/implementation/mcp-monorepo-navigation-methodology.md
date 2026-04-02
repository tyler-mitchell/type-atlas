# MCP Monorepo Navigation Methodology

## Purpose

This document captures a fast, implementation-oriented methodology for using
FeatureType MCP against large TypeScript monorepos.

It is based on direct probing against
`/Users/tylermitchell/.codex/worktrees/ftnav/gitdrops-monorepo`, with the goal
of making code navigation and diagnostics practical for real agent work rather
than only for demos.

This document intentionally ignores `.featuretype`-specific authoring behavior.
It focuses on the TypeScript monorepo path.

Companion docs:

- `docs/implementation/mcp-navigation.md` describes the MCP navigation surface
  and default tool ladder.
- `docs/implementation/mcp-architecture.md` describes runtime ownership,
  sessions, and architectural boundaries.

## Preflight

### 1. Make the target root attachable before doing semantic work

`attach_project` currently depends on a workspace-local TypeScript SDK at:

- `node_modules/typescript/lib`

In the gitdrops case study, the main checkout already had that SDK but the new
git worktree did not. A local symlink in the worktree was enough to make
attachment succeed:

```bash
ln -s /Users/tylermitchell/Projects/gitdrops-monorepo/node_modules \
  /Users/tylermitchell/.codex/worktrees/ftnav/gitdrops-monorepo/node_modules
```

This is currently the first monorepo preflight check:

1. create or choose the worktree
2. verify `node_modules/typescript/lib`
3. only then call `attach_project`

If this preflight fails, semantic tools may look broken when the real issue is
just an unattached project root.

### 2. Snapshot the baseline before any edits

Capture a baseline immediately after attaching the target root:

1. `snapshot_baseline`
2. then start probing or editing

This keeps file-level diagnostics useful during active work, even in noisy
repos.

## Default Lanes

### Lane A: known file, unknown shape

Use this when the file is already known but the internal structure is not.

1. `get_document_symbols`
2. `inspect_symbol`
3. `get_definition` or `get_references` only for focused follow-up

This was the fastest reliable lane in gitdrops.

Observed timings on `packages/github-search-query/src/composer.ts`:

- `get_document_symbols`: about 42 ms
- `inspect_symbol`: about 36 ms
- `get_references`: about 14 ms

These calls were fast enough to use as a default navigation loop.

### Lane B: known symbol name, unknown file

Use this when you know the symbol but not where it lives.

1. `search_workspace_symbols`
2. `inspect_symbol` on the best owning file
3. `get_definition`, `get_type_definition`, or `get_implementations` only after
   the owning file is known

This is the preferred monorepo discovery lane because it stays semantic and
avoids the common failure mode where import-site definition gets stuck on a
local alias or barrel.

`search_workspace_symbols` is now a thin wrapper over Volar
`workspace/symbol`, not a custom MCP graph scan.

Example symbols from the gitdrops case study that fit this lane well:

- `applyGithubQueryTextEdit`
- `RepositoryQueryComposerBase`
- `GithubQueryComposer`

### Lane C: import-site definition stalls on a local alias

In gitdrops, `get_definition` on imported package bindings inside
`apps/web/src/modules/discovery-workbench/composer.tsx` often resolved to the
local import block instead of the owning implementation file.

When that happens:

1. stop repeating `get_definition` on the same import usage
2. run `search_workspace_symbols` on the imported symbol name
3. jump into the best owning file
4. use `inspect_symbol` there
5. if the target is a contract, use `get_implementations`

This is currently the cleanest recovery path for monorepo alias and barrel
navigation.

### Lane D: contract and provider tracing

Use this when the symbol is an interface, abstract type, provider hook, or
factory boundary.

1. `inspect_symbol`
2. `get_type_definition` when value-level definition is too concrete
3. `get_implementations` to find real runtime owners
4. `get_call_hierarchy` if control-flow questions remain

Observed timings from raw language-server probing in gitdrops:

- `textDocument/implementation`: about 30 ms on `LlmClient`
- `textDocument/typeDefinition`: worked well on typed fields such as
  `LanguageModelSession` and `LlmProviderId`
- `textDocument/prepareCallHierarchy`: about 1 ms on `createLlmClient`

### Lane E: active edit and diagnostics loop

Use this after making local code changes.

1. `notify_file_changed`
2. `get_diagnostics(file=...)`
3. `get_enriched_file(file=...)`
4. if the file is clean, optionally escalate to project-level new-only scans

In the gitdrops case study, a one-line probe file produced a clean edit loop:

- `notify_file_changed` acknowledged immediately
- file-scoped diagnostics returned the new type error correctly
- `get_enriched_file` was the easiest proof lane because it kept the file
  context inline with the diagnostic

Observed timing for that file loop:

- `get_diagnostics(file=...)`: about 27 ms

### Lane F: same-file and module tracing

Use this when the question is local usage or module ownership, not full-project
symbol search.

1. `get_document_highlights` for same-file semantic read tracing
2. `get_file_references` for import and module reference tracing
3. `get_references` only when full symbol usage is truly required

Observed timings from raw probing in gitdrops:

- `textDocument/documentHighlight`: about 1 ms with 3 highlights on a local
  variable
- Volar `FindFileReferenceRequest`: about 13 ms with 7 file references on
  `types.ts`

### Lane G: refactor planning before edits

Use this before renaming a symbol or moving a file in a large repo.

1. `prepare_rename`
2. `get_rename_edits`
3. `get_file_rename_edits` when moving or renaming files

Observed timings from raw probing in gitdrops:

- `textDocument/prepareRename`: about 1 ms
- `textDocument/rename`: about 12 ms for a 3-file rename
- `workspace/willRenameFiles`: about 1.16 s for a 3-file rename/move update

### Lane H: project-wide triage is an escalation, not the default

Whole-project diagnostics worked, but they were expensive.

Observed timings in gitdrops:

- `get_diagnostics(scope="new", severity="error")`: about 9.4 s
- `get_diagnostics(summary=true)`: about 8.9 s

Current recommendation:

1. prefer file-local diagnostics first
2. prefer `scope="new"` and `severity="error"` when escalating
3. use `summary=true` to group by file before requesting a full dump
4. avoid broad project scans during routine symbol navigation

The project-wide path is useful for triage, but it is not fast enough to be the
starting point for normal implementation work in a large monorepo.

## Verified Findings From Gitdrops

### What was strong

- File-local symbol orientation was fast and useful.
- `inspect_symbol` was the best single-call answer for “what is this thing?”
- `workspace/symbol` became effective once the workspace had an open document.
- `get_implementations`, file references, and rename planning were fast enough
  to be default monorepo tools.
- File-local diagnostics plus `get_enriched_file` formed a practical edit loop.
- Multi-root attachment worked once the worktree had a usable TypeScript SDK.

### What was weak

- Import-site `get_definition` often stopped at the local import block.
- Export-only barrel files such as `packages/github-search-query/src/index.ts`
  did not provide useful document symbols.
- Whole-project scans were too slow to use as the default navigation lane.
- Raw `workspace/symbol` returned no results before any document had been
  opened.
- Inlay hints returned no useful results in the default probe path, so they are
  not yet a priority MCP surface.

### What changed in this implementation pass

- `search_workspace_symbols` now forwards Volar `workspace/symbol` and the
  session layer bootstraps a workspace document when needed.
- workspace symbol results now preserve the native LSP `WorkspaceSymbol`
  structure instead of being rewritten into a custom MCP symbol record.
- MCP now exposes built-in Volar lanes for type definition, implementations,
  document highlights, file references, call hierarchy, rename planning, and
  file rename edits.
- `get_diagnostics(summary=true)` now returns correct structured scope counts
  instead of always reporting zero in structured output.

## Current Caveats

### Project-wide baseline behavior still needs caution

In the gitdrops case study, a later whole-project scan surfaced additional
`TS2875` “missing react/jsx-runtime” errors as `new` even though the repo had
already been baselined earlier in the session.

That means baseline-aware project scans are useful, but they should still be
treated as a triage signal rather than as unquestioned truth in a large
monorepo. Confirm at the file level before acting on a suspicious repo-wide
classification.

### Workspace symbol search is a fallback lane, not a cheap default

`search_workspace_symbols` uses Volar `workspace/symbol`. It is much better
than blind text search when semantic ownership matters, but it is still more
expensive than file-local orientation.

Observed raw timings in gitdrops:

- `workspace/symbol` for `GeminiPromptApiClient`: about 2.9 s after opening
  documents
- `workspace/symbol` for `buildQualifierCatalog`: about 430 ms after opening
  documents

Use it when:

- the file is unknown
- import-site definition lands on a local alias
- you need to find the owning implementation quickly

Do not use it when a file-local `get_document_symbols` or `inspect_symbol` call
would already answer the question.

## Recommended Agent Playbook

For large monorepos, the current default playbook is:

1. attach the exact root you mean to inspect
2. snapshot the baseline before edits
3. if the file is known, start with `get_document_symbols`
4. if only the symbol name is known, start with `search_workspace_symbols`
5. use `inspect_symbol` as the main narrowing tool
6. use `get_type_definition` and `get_implementations` for contract-heavy code
7. use `get_document_highlights` and `get_file_references` before escalating to
   broader reference searches
8. use rename planning tools before broad semantic refactors
9. keep diagnostics file-local until there is a concrete reason to escalate
10. use project-wide diagnostics only as a filtered triage pass

## Highest-Value Follow-Ups

The next improvements that would most increase monorepo usefulness are:

1. an import-origin or export-chain tracing tool for alias and barrel-heavy
   repos
2. grouped reference summaries by file instead of long flat reference lists
3. expose more existing Volar primitives only where they prove valuable in real
   workflows, starting with semantic tokens and possibly inlay hints if a
   configuration path makes them useful
4. a stronger project-attach preflight surface so “missing TypeScript SDK” is a
   first-class diagnosis instead of an attach-time surprise
