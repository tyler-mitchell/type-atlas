# FeatureType MCP Practical Implementation Feedback

## Goal

Evaluate the MCP as an implementation tool, not just a demo surface.

I used it the way an agent would use it while actively coding:

- isolate a real error in source TypeScript
- navigate unfamiliar symbols across packages
- inspect third-party API shape and deprecation hints
- work inside the project's actual `.featuretype` documents
- compare custom-document behavior against plain `.ts` and `.tsx`

No files were edited during the evaluation.

## What Worked Well

### 1. File-scoped diagnostics are immediately useful

For plain source files, `get_diagnostics` and `get_enriched_file` were strong.

- `packages/mcp/src/index.ts` surfaced the `TS7053` error on `process.argv[2]` quickly.
- `get_enriched_file` made the error much easier to reason about than raw diagnostics because it preserved source context and inlined the diagnostic under the exact line.
- This feels practical for small, targeted implementation work.

### 2. Definition and reference lookup are valuable on normal TypeScript

Navigation worked well in `.ts` and `.tsx`.

- From `packages/mcp/src/server.ts`, `get_definition` jumped from `createVolarHost(...)` to `packages/mcp/src/volar-host.ts`.
- From `packages/mcp/src/server.ts`, `get_type_at` on `server.tool` showed the current overloads and the deprecation notice pointing to `registerTool`.
- In `fixtures/demo-workspace/components.tsx`, `get_definition` on `props.onValueChange` resolved back to the prop declaration, which is exactly the kind of "what is this really?" lookup that helps during implementation.

### 3. Parser/schema diagnostics for `.featuretype` authoring are partially useful

The MCP does catch some root-document problems in `.featuretype` files.

- `fixtures/demo-workspace/broken-button.featuretype` reported `FeatureType documents must declare an <intent> block.`
- `get_code_actions` offered a concrete quick fix to insert an `<intent>` block.

This is good. It means the MCP is already useful for schema-level authoring feedback.

## High-Value Pain Points

### 1. Embedded TypeScript inside `.featuretype` is not being surfaced as diagnostics

This was the biggest issue in the entire evaluation.

Two intentionally broken `.featuretype` examples did not produce the TypeScript diagnostics I would expect:

- `fixtures/demo-workspace/broken-single-select-combobox.featuretype`
  - passes `selectedValue={value}` to `SingleSelectCombobox`
  - the component props in `fixtures/demo-workspace/components.tsx` define `value`, not `selectedValue`
  - `get_diagnostics` returned no diagnostics
- `fixtures/demo-workspace/broken-button.featuretype`
  - renders `<Button tone="destructive">`
  - the component props in `fixtures/demo-workspace/components.tsx` only allow `"primary" | "danger"`
  - `get_diagnostics` only reported the missing `<intent>` block and did not report the invalid `tone`

This is the main blocker to trusting the MCP during actual implementation against `.featuretype` docs.

### 2. Semantic navigation does not bridge from `.featuretype` into the TypeScript graph

I expected `.featuretype` code blocks to participate in the same semantic graph as normal TS/TSX. In practice, they did not.

- `get_definition` on component usages inside `.featuretype` returned no result
- `get_type_at` inside `.featuretype` code blocks returned no result
- `get_signature` inside `.featuretype` code blocks returned no result

This means I cannot treat a `.featuretype` recipe like a real implementation surface when navigating or debugging it.

### 3. References from source components do not include `.featuretype` usages

This was a strong A/B check.

- Plain text search clearly found `Button` and `SingleSelectCombobox` usages across multiple `.featuretype` files.
- But `get_references` on `Button` and `SingleSelectCombobox` in `fixtures/demo-workspace/components.tsx` only returned references inside `components.tsx` itself, not the `.featuretype` usages.

That means the `.featuretype` documents are not currently participating in reference discovery in a way that would help implementation.

### 4. Baseline snapshots appear not to include `.featuretype` files

This likely explains why `.featuretype` issues are hard to trust operationally.

I captured a project baseline first, then later ran file diagnostics on `fixtures/demo-workspace/broken-button.featuretype`.
Its missing-`<intent>` diagnostic came back as `new`, even though the file was already broken before the baseline snapshot.

Likely inference:

- `packages/mcp/src/volar-host.ts` snapshots baselines by iterating `host.getProjectFileNames()`
- that list appears to come from the parsed tsconfig file set
- `.featuretype` files do not seem to be included in that baseline pass, even though they are queryable directly

If this inference is right, new-vs-baseline classification is currently unreliable for `.featuretype` work.

### 5. `get_code_actions` is valuable for structure, weak for actual fix guidance

The tool was useful for schema/document scaffolding:

- adding missing `<intent>`
- inserting `<example>`, `<recipe>`, or `<showcase>`

But it was much less helpful for fixing real implementation issues:

- on plain TS files, it mostly returned generic refactors
- on broken `.featuretype` code, it did not offer fixes for the actual broken props or type mismatch

This means code actions currently help more with document authoring than with implementation debugging.

### 6. Whole-project diagnostics are too large to be practical in one response

Calling `get_diagnostics` without a file path produced a very large result with hundreds of baseline issues and truncation pressure.

That is still useful as a coarse signal, but not ideal for agent workflows because:

- the output is too large to inspect comfortably
- the most important issues are not summarized
- the context window gets consumed quickly

## Tool Surface Gaps

The underlying service plugin appears to support more than the MCP currently exposes.

From the code:

- `packages/service/src/servicePlugin.ts` implements document symbols and hover for `.featuretype`
- the MCP surface in `packages/mcp/src/server.ts` exposes diagnostics, type, signature, definition, references, code actions, enriched file, and file change notification
- there is no MCP tool for document symbols or hover

That gap matters because hover and document symbols are especially valuable in custom authoring formats like `.featuretype`, where raw TypeScript tools are not enough.

## Most Useful Next Improvements

### 1. Make `.featuretype` embedded code produce real TS diagnostics

This is the highest-value fix by far.

Success criterion:

- the broken `selectedValue` prop in `broken-single-select-combobox.featuretype` is reported as a type error
- the invalid `tone="destructive"` prop in `broken-button.featuretype` is reported as a type error

If this works, the MCP becomes much more practical for implementation immediately.

### 2. Include `.featuretype` files in baseline snapshots and project-wide diagnostics

Success criterion:

- a baseline snapshot taken before inspection classifies existing `.featuretype` errors as baseline, not new
- whole-project diagnostics include `.featuretype` issues without needing to query those files one by one

### 3. Make `.featuretype` participate in definition and reference lookup

Success criterion:

- `get_definition` on `Button` or `SingleSelectCombobox` inside `.featuretype` jumps to `components.tsx`
- `get_references` on `Button` and `SingleSelectCombobox` in `components.tsx` includes `.featuretype` usages

This would make the format feel first-class during implementation instead of separate and partially opaque.

### 4. Expose hover and document symbols through the MCP

The service plugin already appears to have meaningful domain knowledge for `.featuretype` tags.

Recommended additions:

- `get_hover`
- `get_document_symbols`

These would likely be more useful in custom documents than raw TS signature help.

### 5. Add a diagnostics summary mode

Recommended behavior:

- grouped counts by file and severity
- optional `new-only`, `errors-only`, or `limit` filtering
- a compact summary for repo-wide scans before requesting a full detailed dump

This would make the MCP much easier to use in real agent loops.

### 6. Improve code actions for implementation fixes

If embedded `.featuretype` TS diagnostics begin working, the next step is to make `get_code_actions` surface the corresponding local fixes rather than only structural insertions and generic refactors.

## Bottom Line

Today, the MCP is already useful for normal TypeScript implementation work.

It is good at:

- file-scoped diagnostics
- enriched error context
- definition lookup
- reference lookup
- type inspection
- SDK/API discovery through types and deprecation metadata

But the most important product-specific path, `.featuretype` implementation support, is not yet strong enough.

Right now `.featuretype` feels split across two partial systems:

- schema-level authoring feedback works
- embedded TypeScript implementation feedback does not reliably surface

If the embedded-code diagnostics, symbol navigation, and baseline coverage are fixed, this MCP becomes dramatically more valuable for the actual workflow it seems designed to support.
