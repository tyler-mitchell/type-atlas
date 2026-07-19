# [bug] TypeScript symbol requests can fail with `Unexpected response type`

## Summary

`document_symbols` and `references` can both fail before returning semantic results with the opaque message `Unexpected response type`.

## Tool and workspace

- Tools: `code_intelligence/document_symbols`, `code_intelligence/references`
- Workspace: `/Users/tylermitchell/Projects/codex-classic`
- File: `src/app-server/contracts/0-144-2.ts`

## Reproduction

Call `document_symbols` with:

```json
{
  "workspace": "/Users/tylermitchell/Projects/codex-classic",
  "file": "src/app-server/contracts/0-144-2.ts",
  "depth": 2
}
```

Call `references` with:

```json
{
  "workspace": "/Users/tylermitchell/Projects/codex-classic",
  "file": "src/app-server/contracts/0-144-2.ts",
  "position": { "line": 439, "character": 8 },
  "includeDeclaration": true,
  "limit": 100
}
```

## Actual behavior

Both tools return an MCP error whose cause is `Unexpected response type`. No upstream response kind, payload excerpt, or recovery guidance is included.

## Expected behavior

Each tool should return its normal bounded semantic result. If the TypeScript server returns an unsupported response, the MCP should identify the command, actual response kind, and safe diagnostic details instead of collapsing the failure into an opaque message.

## Impact

The failure prevents semantic inspection of a load-bearing generated-contract adapter and forces agents back to textual search and full-file reads. Because two independent semantic commands fail on the same file, callers cannot recover by switching between common MCP inspection affordances.

## Suggested fix

Harden the TypeScript protocol response decoder to accept the valid response shapes produced for this file and include the command plus received response discriminant in conversion errors. Add an integration fixture using this file shape or an equivalent generated module with many imported declaration contracts.

# [enhancement] Apply transactional semantic workspace edits

## Summary

Provide a transactional workspace-edit boundary that can compute and apply language-service renames, code actions, and validated multi-file edits in one call.

## Tool and workspace

- Proposed tools: `rename_symbol`, `code_actions`, `apply_workspace_edit`
- Workspace observed: `/Users/tylermitchell/Projects/codex-classic`
- Representative files: `src/runtime/source-derivation.ts`, `src/app-server/contracts/0-144-2.ts`, and their tests

## Reproduction

1. Use `references` or `document_symbols` to establish a symbol boundary.
2. Read every affected file separately.
3. Submit an external patch operation.
4. Call `diagnostics` on each changed file.
5. Re-read or diff the files to ensure the patch applied to the intended versions.

Even a small cross-file refactor therefore requires multiple inspection calls, an unrelated filesystem editing mechanism, and manual stale-read protection.

## Actual behavior

The MCP exposes semantic inspection but no semantic mutation. Agents must translate semantic findings into textual patches, cannot request TypeScript-native rename or code-action edits, and cannot atomically apply a multi-file `WorkspaceEdit` with source-version preconditions.

## Expected behavior

The MCP should expose TypeScript/LSP-native edit computation and a common atomic application boundary supporting text edits plus file create, rename, and delete operations. The application request should require per-file version or content-digest preconditions, return a normalized diff, reject overlapping or stale edits, and either apply every edit or none.

## Impact

This is the main throughput limit after semantic discovery. It increases tool-call count, makes large refactors slower, and reintroduces textual replacement hazards precisely where the language service already knows the correct multi-file change.

## Suggested fix

Add `rename_symbol` and `code_actions` tools that return a normalized workspace-edit plan, plus `apply_workspace_edit` with `dryRun`, expected document versions or SHA-256 digests, atomic commit semantics, formatting control, and post-apply diagnostics. Keep edit computation separate from application so agents can inspect the diff before committing high-impact changes while still allowing a single-call compute-and-apply mode for trusted mechanical refactors.

# [bug] Diagnostics retain stale missing-module errors after dependency installation

## Summary

`diagnostics` can retain a missing-module error after the declared dependency has been installed and the TypeScript compiler resolves it successfully.

## Tool and workspace

- Tool: `code_intelligence/diagnostics`
- Workspace: `/Users/tylermitchell/Projects/codex-classic`
- File: `src/app-server/contracts/0-144-2.ts`
- Dependency: `ajv@8.20.0`

## Reproduction

1. Ensure `package.json` and `pnpm-lock.yaml` declare `ajv@8.20.0`, but the workspace `node_modules` has not yet been synchronized.
2. Run `pnpm install --frozen-lockfile`; pnpm installs `ajv` successfully.
3. Run `pnpm typecheck`; `tsc --noEmit` exits successfully.
4. Run the Vitest suites importing `src/app-server/contracts/0-144-2.ts`; they pass.
5. Call `diagnostics` with:

```json
{
  "workspace": "/Users/tylermitchell/Projects/codex-classic",
  "file": "src/app-server/contracts/0-144-2.ts"
}
```

## Actual behavior

The MCP continues to report `error ts(2307) 4:59-4:64 Cannot find module 'ajv' or its corresponding type declarations.`

## Expected behavior

Dependency installation or lockfile/node_modules changes should invalidate the selected TypeScript project and module-resolution caches automatically, or the MCP should expose a deterministic workspace/project reload operation. Diagnostics should agree with a fresh TypeScript project using the same configuration.

## Impact

Agents receive false compiler errors after routine dependency synchronization and cannot distinguish stale MCP state from a real source defect without invoking an external compiler. This undermines diagnostics as a primary verification tool.

## Suggested fix

Watch `package.json`, workspace manifests, lockfiles, and relevant `node_modules` resolution state, then recreate or reload the affected TypeScript project when they change. Also provide an explicit `reload_project` fallback and return the project generation/version in diagnostics responses so callers can verify freshness.

# [usability] Batch source reads need independent options and partial failures

## Summary

Extend the new multi-file `read_file` form with independent ranges and per-file errors so one invalid file does not discard successful reads.

## Tool and workspace

- Tool: `code_intelligence/read_file`
- Workspace: `/Users/tylermitchell/Projects/codex-classic`
- Representative files: `src/transforms/settings-mod.ts`, `src/commands/verify.ts`, and `src/diagnostics/runtime.ts`

## Reproduction

1. Call `read_file` with `file` set to `['src/diagnostics/runtime.ts', 'src/does-not-exist.ts', 'tests/diagnostics.test.ts']`, `startLine: 1`, `endLine: 12`, `fold: false`, and `includeDiagnostics: true`.
2. Observe that the first and third files exist and contain the requested range while the middle path does not exist.
3. Remove the missing path and retry; both valid files are returned successfully.

## Actual behavior

The request returns only `File is not a regular file: src/does-not-exist.ts`. No content is returned for either valid file. Shared ranges now handle files of different lengths correctly by returning each file through its available end, but the batch still cannot express per-file ranges and treats one invalid path as failure of the entire request.

## Expected behavior

`read_file` should retain the convenient `file: string[]` form and also accept a bounded `reads` array whose entries can specify `file`, optional `startLine`, `endLine`, `fold`, and `includeDiagnostics`. Batch results should preserve request order and return content or a structured error per file.

## Impact

The implemented batch form already reduces protocol overhead for whole-file review, and heterogeneous file lengths now work correctly. Its all-or-nothing path validation still makes exploratory cross-file reads brittle: one stale, renamed, or mistyped path discards every successful sibling read.

## Suggested fix

Add a batch form such as `{ workspace, reads: [{ file, startLine?, endLine?, fold?, includeDiagnostics? }] }` alongside `file: string[]`, with conservative item and aggregate byte limits. Validate and execute entries independently, deduplicate identical reads, and return per-entry truncation metadata and errors without suppressing successful siblings.
