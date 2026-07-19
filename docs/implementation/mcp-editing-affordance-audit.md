# MCP Editing Affordance Audit

## Decision boundary

FeatureType should expose agent-oriented editing without recreating semantic or
protocol behavior already owned by Volar, LSP, or the VS Code language client.
This audit assigns each part of the editing lifecycle to its existing owner and
defines the narrow headless-client gaps that remain.

The implementation is not accepted until every retained custom behavior has a
specific gap in this matrix. Installed source is the authority for the versions
listed here.

The exact installed-source findings and their executable evidence are recorded
in [volar-affordance-evidence.md](./volar-affordance-evidence.md).

## Installed upstream surface

| Layer | Installed version | Verified affordance | Ownership consequence |
| --- | --- | --- | --- |
| `@volar/language-service` | 2.4.28 | Rename, file-rename edits, code actions and resolution, formatting, completion edits, drop edits, auto-insert snippets, linked editing, inlay hints, color presentations, code lenses, and command dispatch | FeatureType must call these producers and preserve their results; it must not reproduce their semantic reasoning. |
| Volar edit transformation | 2.4.28 | Embedded/source mapping, rename-text transformation, linked-code traversal, multi-plugin merge, deduplication, and ordered document-change insertion | Returned source-space `WorkspaceEdit` values are the canonical semantic result. |
| `@volar/language-core`, `@volar/source-map`, `@volar/typescript` | 2.4.28 | Virtual-code/source maps, linked mappings, TypeScript language-service hosts, and project snapshots | These are already consumed beneath Volar's language service. The MCP must not add a second embedded-file or TypeScript project model. |
| `WorkspaceChange` / `TextEditChange` | LSP types 3.17.5, re-exported by Volar | Standard builders for versioned text edits, create/rename/delete operations, and change annotations | Use for producer-side construction when its per-document grouping preserves the required operation order; do not rebuild protocol literals by hand. |
| `@volar/kit` | 2.4.28 | `createFormatter` applies Volar formatting edits with `TextDocument.applyEdits`; checker `fixErrors` resolves and merges code actions, then writes text results through a callback | Confirms the canonical text-edit path. It is not a general executor: `fixErrors` ignores resource operations with an explicit upstream TODO and does not enforce versions, permissions, or multi-file commit semantics. |
| `@volar/language-server` Node filesystem | 2.4.28 | Cached `stat`, `readFile`, and `readDirectory` providers plus file-watch invalidation | Reuse the server for semantic reads and refresh; it intentionally has no write/create/rename/delete contract. |
| Volar TypeScript project host | 2.4.28 | Nearest `tsconfig` selection, configured/inferred project ownership, watched-file project-version updates, command-line refresh on create/delete, config-project disposal, and public project `reload()` | File-to-project routing and ordinary semantic invalidation stay inside Volar. FeatureType wires the official reload notification only for project-shape files. |
| Volar experimental editor protocol | 2.4.28 | Matching-tsconfig, virtual-file/code, service-plugin state, project reload, document-drop, and auto-insert requests | Reload is reused for manifest/config recovery. Matching-tsconfig proves nearest-project ownership is already upstream. Virtual-code inspection is a future read-only ergonomics opportunity, not an edit executor. |
| `@volar/test-utils` | 2.4.28 | Child-process LSP harness with document synchronization and request helpers | Useful as test evidence, not a production client applier: it has no `workspace/applyEdit` handler, resource executor, permission boundary, or file-rename lifecycle. |
| `volar-service-typescript` | 0.0.65 | TypeScript rename, file-reference updates, quick fixes, fix-all, organize imports, refactors, formatting, and lazy code-action resolution | TypeScript compiler edits already arrive through Volar; custom TypeScript edit generation is unnecessary. |
| `vscode-languageserver-protocol` / `types` | 3.17.5 | `WorkspaceEdit`, ordered `documentChanges`, versions, annotations, create/rename/delete operations, failure strategies, `workspace/applyEdit`, file-operation requests, and execute-command ordering | FeatureType should use protocol values as its internal edit contract. |
| `vscode-languageserver-textdocument` | 1.0.12 | Canonical position/offset conversion and stable, overlap-checking `TextDocument.applyEdits` | Custom LSP position math and text-edit application must be removed. |
| `vscode-jsonrpc` | 8.2.0 | Cancellation tokens and an internal FIFO semaphore | Reuse cancellation tokens. Do not replace the root queue with the semaphore: it is not exported from the package API and cannot cancel/remove queued work. |
| `vscode-languageclient` | 9.0.1 | Serial workspace-edit conversion, annotation/resource conversion, open-document version checks, and delegation to `vscode.workspace.applyEdit` | This is the behavioral reference for a client. Its executor cannot be reused outside the VS Code extension host. |
| `@volar/vscode` | 2.4.28 | Adapts Volar editor-command arguments, applies document-drop `additionalEdit`, supplies binary initial contents for dropped files, and inserts auto-edit snippets | These adapters require the `vscode` extension host. Headless tools should expose editor-only commands as typed follow-up data, not send their raw arguments to a server command path. |
| VS Code API types | 1.110.0 | Ordered multi-resource edits, text-only all-or-nothing application, resource-operation abort semantics, metadata, and initial create-file contents | Headless behavior should match this contract where the protocol permits it, without claiming stronger guarantees. |
| MCP SDK | 1.28.0 | Destructive/read-only annotations, cancellation signals, request-scoped progress, client roots and root-list changes, form elicitation, and experimental task tools | Use roots for attachment, progress for visible phases, and elicitation for required change-annotation confirmation. Tasks do not replace synchronous workspace-edit application. |

## Canonical lifecycle

The lifecycle has four distinct owners:

1. An agent-facing producer describes intent. Semantic producers use operation
   parameters such as symbol position, new name, action selection, or file move.
   Arbitrary source edits use exact source anchors or complete new content.
2. Volar or another producer returns a standard `WorkspaceEdit`. FeatureType may
   compose a physical `RenameFile` with Volar's `willRenameFiles` reference
   edits because the editor normally owns that separate operation.
3. A headless workspace-edit applier interprets the protocol value. It uses
   `TextDocument.applyEdits`, honors `documentChanges` ordering and preference,
   checks versions/baselines, enforces workspace permissions, and performs file
   operations.
4. The existing manager refreshes the language-server session after successful
   disk changes.

All semantic tools and future Codemorph producers should converge at step 2.
There should not be separate planning, preview, commit, or recovery engines for
each producer.

## Affordance matrix

| Behavior | Upstream owner | FeatureType responsibility | Status |
| --- | --- | --- | --- |
| Symbol rename eligibility and span | Volar `getRenameRange` | Adapt file/line/column inputs | Reuse directly |
| Symbol rename edits | Volar `getRenameEdits` | Apply or preview returned edit | Reuse directly |
| File-reference updates during move | Volar `getFileRenameEdits` and `willRenameFiles` plus LSP `WorkspaceChange` | Normalize the returned edit to the protocol-preferred `documentChanges` lane, then append the physical resource move | Thin composition implemented with the standard builder |
| Quick fixes and refactors | Volar `getCodeActions` plus `resolveCodeAction` | Select an action and apply edit before command | Reuse directly |
| Formatting | Volar `getDocumentFormattingEdits` | Expose an agent-oriented apply/preview tool | Reuse directly through `format_file` |
| TypeScript fix-all and organize imports | `volar-service-typescript` code-action resolution | Select and apply the resolved action | Reuse directly |
| Embedded-file mapping | Volar `transformWorkspaceEdit` | Preserve output unchanged | No custom mapping |
| Linked rename traversal | Volar rename worker | Preserve output unchanged | No custom traversal |
| Workspace-edit merge/deduplication | Volar `mergeWorkspaceEdits` and dedupe utilities | Use Volar's already-merged producer result. Do not use `mergeWorkspaceEdits` to append a physical move: it can retain both `changes` and `documentChanges`, and its document-change helper coalesces same-document edits across resource-operation boundaries. | Reused inside Volar; deliberately not reused for ordered client composition |
| Text edit ordering and overlap checks | `TextDocument.applyEdits` | Construct a document and call it | Reused directly |
| `changes` versus `documentChanges` | LSP `WorkspaceEdit` | Prefer `documentChanges` when present | Implemented |
| Ordered create/rename/delete/text operations | LSP `documentChanges` | Execute sequentially against staged state | Narrow custom applier gap |
| Change annotations | LSP, VS Code client conversion, and MCP elicitation | Preserve labels; accept an explicit decision or request one from an elicitation-capable client | Implemented with native MCP form elicitation |
| Version checks | LSP and VS Code language client | Compare versioned open documents or equivalent baselines before mutation | Implemented for open versions and exact-operation revisions |
| Line-ending normalization | Client capability | Do not advertise unless implemented | Not advertised |
| Directory rename/deletion | LSP `RenameFile` and `DeleteFile` also cover folders, but the FeatureType editing contract is regular-source-file scoped | Keep guarded file move/delete for explicit agent operations; advertise only server-produced `CreateFile` support | Deliberately not advertised |
| Failure handling | LSP capability and VS Code apply semantics | Advertise the exact implemented strategy; roll back ordered text and resource operations on ordinary runtime failure | Advertises transactional handling |
| Server command dispatch | Volar/LSP `executeCommand` | Dispatch only commands advertised by the server and capture `workspace/applyEdit` | Implemented |
| Editor rename command | Volar built-in `editor.action.rename` | Treat as a required follow-up semantic rename, not a server command | Returned as follow-up metadata |
| Editor selection/reference commands | Volar built-in commands | Return navigation metadata; do not pretend they mutated code | Returned as follow-up metadata |
| Cancellation | MCP `AbortSignal`, JSON-RPC cancellation token, Volar cancellation | Bridge the signal through generation and stop before commit | Implemented for editing producers and commit boundary |
| Progress | MCP request metadata and `notifications/progress` | Report lock wait, generation, confirmation, preparation, commit, refresh, and completion only when the caller requests progress | Implemented and integration-tested |
| Workspace roots | MCP `roots/list` and `notifications/roots/list_changed` | Adopt file roots lazily, prefer the client's current workspace over stale persisted state, then retain FeatureType's path ownership checks | Implemented and integration-tested |
| Language-server freshness | LSP `didChangeWatchedFiles` client capability and notification | Advertise the capability before initialization, then notify all committed paths | Implemented; graph-changing create is integration-tested |
| Project-shape recovery | Volar `LanguageServerProject.reload()` and `ReloadProjectNotification` | Wire the notification in the FeatureType server and emit it after changed configs, manifests, or lockfiles | Implemented as a narrow upstream bridge |
| Sandbox grants | Codex request metadata | Enforce write grants before disk mutation | Custom host boundary required |
| Disk commit and rollback | No reusable Volar/LSP headless executor; Volar's filesystem is read-only and VS Code's executor requires the extension host | Keep the smallest staged writer needed to match advertised failure handling | Custom gap |
| Crash recovery | No installed upstream facility | Do not claim crash atomicity; add a journal only if that guarantee becomes required | Deferred |

## Producer decisions

### Contract alternatives

| Contract | Agent ergonomics | Upstream reuse | Decision |
| --- | --- | --- | --- |
| Raw `WorkspaceEdit` input | Exposes URIs, zero-based ranges, versions, resource ordering, and annotations | High internally | Reject as a public tool; retain as the internal boundary |
| Free-form unified diff | Familiar to patch tools but makes the model author hunk syntax and duplicates patch parsing | Low | Reject |
| Complete file bodies | Simple for creation but expensive and stale-prone for ordinary edits | Low | Keep only as an explicit guarded operation |
| Persistent preview/change IDs | Supports later apply and undo but adds state, expiry, approval indirection, and extra calls | Medium | Remove from the default lifecycle; reintroduce only for a demonstrated long-running workflow |
| Semantic producer tools plus one shared applier | Agent supplies rename/action/format intent; Volar supplies protocol edits | Highest | Select |
| Exact arbitrary operations compiled to `WorkspaceEdit` | Covers changes Volar cannot infer without exposing diff or LSP syntax | High after the thin compiler | Select as the patch-replacement lane |

The selected public surface therefore has two lanes, not two execution engines:
semantic intent and arbitrary exact intent. Both immediately produce the same
`WorkspaceEdit`, pass through the same preview/materialization step, and use the
same disk boundary.

The first implementation should expose the editing producers with the highest
agent value:

- arbitrary exact source changes, compiled once into `WorkspaceEdit`
- symbol rename with direct apply or bounded preview
- file move with Volar reference edits plus one resource operation
- resolved code-action apply
- document formatting apply

Completion insertion, document-drop edits, snippets, linked-editing UI, color
presentations, and code-lens commands are verified upstream affordances but do
not replace patch-style source editing. They should use the same applier if they
are exposed later. Completion and snippet application also require editor
insertion rules that are not represented by plain `WorkspaceEdit`, so exposing
them now would broaden the custom client surface without improving the core
editing contract.

## Resulting implementation

`workspace-edit.ts` is the single headless boundary. It materializes protocol edits with
`TextDocument.applyEdits`, validates annotations, versions, UTF-8 inputs, roots,
and sandbox grants, preserves ordered resource/text steps, commits under a
per-root lock, rolls ordinary failures back in reverse order, refreshes Volar,
and reports a bounded text preview. Physical renames use `fs.rename` rather than
being collapsed into content rewrites, so inode and mode survive a move.

The public mutation tools are stateless:

- `edit_workspace` compiles exact agent intent to `WorkspaceEdit`
- `rename_symbol` applies Volar rename edits
- `move_file` composes Volar reference edits with the physical rename
- `apply_code_action` resolves and applies one selected action
- `format_file` applies Volar formatting edits

The read-only `get_rename_edits`, `get_file_rename_edits`, and
`get_code_actions` tools remain discovery surfaces. They do not allocate server
state or return opaque apply handles. Code actions remain unresolved while
listed and are resolved only after selection, matching Volar and VS Code's lazy
contract.

## Rejected upstream substitutions

The following installed helpers were inspected and are intentionally not used
as the headless executor:

- `@volar/kit` checker `fixErrors` only writes text through a callback and has
  an explicit TODO for create/rename/delete operations. It has no version,
  permission, transaction, or annotation-confirmation boundary.
- Volar's Node filesystem provider is read-only and cache-oriented.
- `@volar/typescript.createSys` exposes the underlying TypeScript system's raw
  `writeFile`, but it is compiler/project I/O: it has no workspace-edit
  ordering, versions, annotations, authorization, transaction, or client
  acknowledgment.
- `@volar/test-utils` is a request harness. It does not handle
  `workspace/applyEdit` or production resource operations.
- `vscode-languageclient` delegates the final operation to
  `vscode.workspace.applyEdit`; importing it headlessly also imports the
  extension-host-only `vscode` module.
- `WorkspaceChange` is the right builder, but it cannot safely migrate a
  legacy `changes` edit to ordered `documentChanges`, and it groups text edits
  per document. FeatureType uses it only where that grouping cannot cross a
  resource-operation boundary.
- Volar's public `mergeWorkspaceEdits` is a semantic merge helper, not a
  general ordered transaction composer. Appending a resource operation with it
  can create a protocol value whose `changes` branch is ignored.
- The semaphore used internally by `vscode-languageclient` serializes
  conversion but offers no cancellation or queue removal. FeatureType's lock
  must remain per-root and cancellation-aware.
- The Volar virtual-file and service-plugin laboratory protocols expose useful
  inspection/state controls, not disk edit application.

The remaining custom code is therefore a client/host boundary, not a language
service: exact-intent compilation, Codex grant interpretation, UTF-8 filesystem
application, per-root serialization, rollback, preview rendering, and Volar
cache notification.

## Acceptance examples

The final contract must support these cases without exposing URIs, LSP ranges,
or protocol plumbing to the agent:

1. Rename a symbol across several files in one mutating call.
2. Move a file and update imports in one mutating call.
3. Select and apply a resolved quick fix or refactor.
4. Apply independent arbitrary changes to several files in one call.
5. Reject overlapping or stale changes without partial text mutation.
6. Preserve ordered create-then-edit and rename-then-edit sequences.
7. Cancel generation or staging before disk commit.
8. Report an editor-command follow-up instead of silently dropping it.

Future Codemorph integration passes through the same producer-to-`WorkspaceEdit`
boundary. Codemorph-specific transformation syntax must not leak into the
applier or create a second transaction system.
