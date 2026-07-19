# MCP Ergonomics

## Purpose

This is the living implementation reference for agent-facing FeatureType MCP
ergonomics. It records verified current behavior, concrete friction observed
during real code work, and the highest-leverage improvements that remain.

Executable behavior, current source, and tests take precedence over older
architecture or discovery prose. Update this document when implementation work
reveals a repeatable productivity cost or proves that a listed gap is closed.
The validated upstream ownership record is
[volar-affordance-evidence.md](./volar-affordance-evidence.md).

## Current Editing Contract

FeatureType has two agent-facing producer lanes and one execution engine:

1. `read_file` with `mode="exact"` returns unfurled source and a whole-file
   revision. Optional `startLine` and `endLine` bounds keep large reads small.
2. `edit_workspace` accepts an ordered batch of desired operations:
   `replace`, `write`, `create`, `move`, and `delete`.
3. `rename_symbol`, `move_file`, `apply_code_action`, and `format_file` accept
   semantic intent and let Volar produce the edits.
4. Every producer converges on an LSP `WorkspaceEdit`, which one headless client
   previews or applies. Apply is the default; preview is stateless.

Agents do not author diffs, URIs, LSP ranges, or `WorkspaceEdit` objects.
Exact replacements validate their own context. Whole-file writes, moves, and
deletes use revisions from exact reads.

File moves compose the physical resource operation that an editor normally
performs outside `willRenameFiles`. Resolved CodeAction edits run before
commands as LSP requires. Commands advertised by the language server execute
there and any `workspace/applyEdit` request re-enters the shared executor.
Volar's editor-only rename, selection, and reference commands are returned as
explicit follow-up metadata instead of being sent to an unhandled server path.

### Volar ownership boundary

Volar already owns semantic edit production, linked-code traversal, embedded
document to source-document mapping, multi-plugin edit merging, CodeAction
resolution, rename/file-rename edit generation, and language-service command
dispatch. FeatureType must retain those returned `WorkspaceEdit` and command
values losslessly; it must not recreate their semantic reasoning.

The headless MCP client still owns behavior Volar intentionally leaves to an
editor client: applying source-space text/resource operations to disk,
performing the physical move after `willRenameFiles`, enforcing permissions and
stale baselines, committing or restoring files, and acknowledging
`workspace/applyEdit` requests.

The executor uses `vscode-languageserver-textdocument`
`TextDocument.applyEdits`; there is no custom LSP position math. It prefers
`documentChanges` over `changes`, preserves same-position insertion order,
checks versioned edits, and preserves annotations. Required annotations accept
an explicit decision or use MCP form elicitation when the client supports it.
The language client advertises transactional failure handling and does not
claim line-ending normalization.

## Safety And Concurrency Properties

- One edit call can change many files.
- Semantic edit generation and commits serialize per attached root so an
  unversioned Volar edit cannot be generated behind another MCP mutation.
- Lock waits are cancellable. Reads remain independent.
- Per-path revisions reject stale agent intent before mutation.
- Text edits and LSP resource operations are simulated completely before disk
  mutation.
- Text bodies stage in a same-filesystem transaction directory. Physical
  renames remain real renames; ordered create/rename/delete/text steps roll back
  in reverse on ordinary commit failure, including newly created empty parent
  directories.
- MCP cancellation reaches JSON-RPC/Volar semantic requests and is checked
  again before crossing the disk commit boundary.
- Valid UTF-8 regular files are supported. Symlink traversal, binary mutation, and
  recursive directory deletion are rejected explicitly.
- Every successful apply refreshes the owning language-server session and
  attached project file count. Refresh failures are returned as warnings after
  the already-successful commit, not misreported as edit failures.
- Project-shape changes additionally invoke Volar's project `reload()` through
  its official protocol; ordinary source changes retain the cheaper native
  watched-file path.
- MCP client roots are adopted automatically and refreshed on root-list-change
  notifications; manual attachment remains an override and fallback.
- Mutating tools emit bounded phase progress when the request includes a
  progress token.
- The MCP advertises Codex sandbox-state metadata support and enforces attached
  root, managed write grants, and protected metadata boundaries.

## What Currently Works Well

- Compact `read_file` output is effective for orientation.
- Exact ranged reads now provide an implementation-grade escape hatch when
  folding hides a required body.
- `inspect_symbol` can return the complete selected source body from Volar's
  workspace-symbol range and direct same-file callees from Volar call
  hierarchy. Workspace-symbol lookup resolves overloaded implementations
  instead of returning the first document-symbol signature. Reference
  summaries and module export paging reduce additional semantic navigation
  round trips.
- Rename, file move, resolved code action, and formatting are direct mutation
  tools with optional stateless preview.
- Desired-operation batches are substantially easier to author and review than
  patch syntax while retaining create/update/move/delete coverage.
- Exact source anchors remain a useful agent-facing input for arbitrary edits.

## Highest-Leverage Remaining Improvements

### Implementation-grade semantic slices

The bounded `inspect_symbol` source lane now returns the complete selected
declaration and direct same-file callees without requiring file ranges. Extend
that semantic slice with optional caller bodies, cross-file callees, type and
implementation bodies, and stable continuation metadata.

### Batch semantic inspection

Architecture work routinely needs five to ten connected symbols. Add a
multi-target semantic slice request so independent symbol/file queries do not
require serial tool round trips. Preserve per-target budgets and partial-result
continuation rather than truncating the combined middle.

### Freshness observability

FeatureType now advertises watched-file support before Volar initialization,
notifies every committed path, and uses Volar's own project reload for configs,
package manifests, and lockfiles. Graph-changing file creation and config
changes are covered end to end. Add diagnostic metadata that reports the
matched tsconfig, project version, and last refresh/reload reason so a remaining
external `node_modules` or filesystem-watcher problem is observable rather than
indistinguishable from a semantic miss.

### Explicit cross-project search scope

Native MCP roots now replace stale persisted-root history as the default current
workspace and file-scoped requests choose the deepest containing attached root.
Within that root, Volar already selects the nearest configured or inferred
TypeScript project and exposes the decision through `GetMatchTsConfigRequest`.
Cross-root workspace-symbol search should still require an explicit scope and
report it before results.

### Conflict explanation and repair

Stale exact intent fails safely but currently reports only the conflicting path
and revisions. Add a read-only explanation that identifies which anchor or
baseline changed and, where exact anchors remain unique, can derive a corrected
preview without mutating disk.

### Bounded lock waits and recovery guidance

Mutating tools now report lock wait, generation, confirmation, preparation,
commit, refresh, and completion. Cancellation also interrupts a queued lock
wait. Add elapsed time and a configurable bounded-timeout error so unattended
clients can distinguish a busy workspace from a dead process and retry safely.

### Host-native review integration

Standard MCP calls inherit Codex approval routing and hooks but cannot update
Codex's private turn diff tracker or native streaming patch UI. FeatureType's
text previews cover agent capability, not invisible host UI integration. A
future host bridge should consume the standard `WorkspaceEdit` boundary and
result metadata rather than introduce a second editing contract.

### Crash recovery

The executor rolls back ordinary runtime failures, but a process or machine
crash between per-file renames can leave the hidden transaction directory or a
partially applied batch. Add a small durable transaction journal and startup
recovery before describing commits as crash-atomic.

### Codemorph producer integration

The integration seam is `WorkspaceEdit`. Codemorph should contribute protocol
edits or a thin producer that compiles its stable transformations to protocol
edits. The shared headless client remains the sole owner of materialization,
baselines, permissions, commit, and refresh. Codemorph-specific syntax must not
enter the executor.

### Generated-domain inspection

Repositories with generated shader, topology, or binding domains need semantic
links beyond TypeScript references. Keep this behind domain adapters that add
generated ownership/dataflow evidence to semantic slices; do not weaken the
language server as the TypeScript source of truth.

## Known Validation Debt

The focused editing tests and editing integration cases pass. The broader MCP
integration suite still contains expectations for `get_diagnostics` and
`validate_files` even though those registrations are currently disabled. Those
failures predate the editing surface and should be reconciled by either
re-enabling the tools or updating the probes; they should not be treated as
editing regressions.

The in-memory and stdio probes exercise active capabilities only: attachment,
semantic hover, and an ephemeral TypeScript edit that is verified on disk and
removed. They no longer require a deliberately hidden diagnostics tool, so a
green probe represents transport, semantic, and editing health rather than a
known mixed result.

The repository's codified MCP validation lanes remain the in-memory and stdio
probes under `packages/mcp`. Live session-attached validation additionally
requires built service, language-server, and MCP artifacts before restart.

## Completion Standard For Ergonomic Changes

An ergonomic change is complete when it:

- removes a repeated agent decision, round trip, or lossy translation
- preserves the language server as the semantic owner
- keeps canonical result bodies text-first and structured content
  metadata-first
- has bounded output and continuation behavior where results can grow
- has a safe concurrency and stale-state story
- is exercised through the in-memory MCP boundary, not only a helper function
- updates this document when current behavior or the opportunity ranking changes
