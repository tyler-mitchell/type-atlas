# FeatureType Onboarding And Volar.js Ideation

## Why This Note Exists

This is the current onboarding note for the repo as it exists today, plus an initial architecture read of [`volarjs/volar.js`](https://github.com/volarjs/volar.js) to help sharpen FeatureType's early shape.

The goal is not to inherit Volar.js wholesale. The goal is to extract reusable architectural lessons from a mature TypeScript-first tooling platform.

For current implementation-facing Volar guidance, prefer [`docs/discovery/volar-ecosystem-research.md`](./volar-ecosystem-research.md). This note remains the broader onboarding and ideation document, while the newer Volar note is the more source-grounded place to reason about actual integration choices.

For the implemented editor MVP, prefer [`docs/implementation/featuretype-vscode-mvp.md`](../implementation/featuretype-vscode-mvp.md). Parts of this note describe the earlier pre-implementation repo state and should be read as historical ideation rather than the current architecture.

## FeatureType: Verified Current State

Repository observations from `/Users/tylermitchell/Projects/featuretype` at the time this note was first written:

- the repo is a minimal PNPM workspace with `apps/*` and `packages/*`
- there are currently no files inside `apps/` or `packages/`
- the main existing project document is `featuretype-project-init.handoff.md`
- there is no product code yet

Runtime checks:

- `pnpm build` exits successfully and executes zero package build tasks
- `pnpm test` exits successfully and executes zero package test tasks
- `pnpm check-types` exits successfully and executes zero package type-check tasks

Practical implication: FeatureType is still free to choose its real core abstraction without migration pressure.

## Volar.js: What Was Reviewed

Research date: March 28, 2026.

Upstream repo signals gathered from the local snapshot and GitHub API:

- repo: `volarjs/volar.js`
- license: MIT
- default branch: `master`
- recent package version visible in package manifests: `2.4.28`
- GitHub reported `1230` stars and `71` forks
- latest visible commit in the API sample: `44d58ae` on March 5, 2026

The first `giget` fetch attempt against `#main` failed with `404 Not Found`, so the working snapshot used for this read came from a shallow `git clone` against the repository default branch.

## Architectural Read Of Volar.js

### 1. The package split is the product

The top-level README describes Volar.js less as a single app and more as a stack:

- `@volar/language-core`
- `@volar/language-service`
- `@volar/language-server`
- `@volar/vscode`
- `@volar/kit`
- `@volar/monaco`

That split matters. The codebase treats the reusable engine as primary, and editor integrations as downstream adapters rather than the main event.

### 2. `language-core` owns the canonical derived representation

The strongest idea in Volar.js is not "language server." It is "derive stable virtual representations, then map between them and source."

Key signals:

- `packages/language-core/index.ts` exposes `createLanguage(...)`
- `packages/language-core/lib/types.ts` defines a `LanguagePlugin` contract with `createVirtualCode`, `updateVirtualCode`, and `isAssociatedFileOnly`
- `createLanguage(...)` maintains script registries, virtual-code lifecycles, source mappings, linked-code mappings, and association invalidation

The important lesson for FeatureType is the existence of a canonical internal model that is richer than raw source files and still incrementally maintainable.

### 3. `language-service` is a capability layer over shared context

`packages/language-service/lib/languageService.ts` composes many feature providers into one service surface. It builds a shared context once, then exposes capabilities like:

- diagnostics
- rename
- references
- hover
- completion
- code actions
- formatting
- document symbols

This is useful because it keeps the engine boundary separate from the user-facing feature boundary.

For FeatureType, that suggests a middle layer that answers questions about reusable features instead of coupling every consumer directly to the raw knowledge graph.

### 4. The adapters stay relatively thin

The adapter packages are notably small compared to the core:

- `packages/monaco/index.ts` is effectively just a narrow export surface
- `packages/vscode/index.ts` is focused on client adaptation and command translation
- `packages/language-server/node.ts` wires transports and file-system providers
- `packages/language-server/lib/server.ts` mostly composes registries and feature modules

The lesson is not "FeatureType must use LSP." The lesson is "once the core is real, adapters should mostly translate environments, not reinvent behavior."

### 5. `kit` creates a non-editor entry point

`@volar/kit` is especially relevant.

Its README and implementation show a simpler Node-facing surface for:

- creating a project
- watching files
- checking diagnostics
- formatting

This is a good pattern for FeatureType because it avoids making editor integration the only way to benefit from the system.

## What Seems Transferable To FeatureType

### A. Separate the knowledge core from the interaction surfaces

A promising FeatureType stack could look like:

- `@featuretype/core`
  The canonical model for reusable things, their intent, examples, anti-patterns, relationships, and provenance.
- `@featuretype/service`
  Query and reasoning APIs such as "what should I use here?", "show the common examples", "what is related?", and "what is the safe default?"
- `@featuretype/kit`
  Batch and Node workflows for indexing, validation, extraction, auditing, and CI use.
- adapters
  VS Code, Monaco, CLI, MCP, browser UI, or other consumers.

This is the cleanest architectural lesson from Volar.js.

### B. Treat `.featuretype` as one possible source format, not the product itself

The handoff's `.featuretype` sketches are helpful, but Volar.js suggests a stronger framing:

- authoring format is an input boundary
- internal graph is the durable system boundary
- adapters consume the graph, not the authoring syntax directly

That would keep FeatureType flexible if the best ingestion path later becomes a mix of:

- `.featuretype` files
- inferred examples from code
- extracted stories or tests
- curated docs or design-system notes

### C. Model relationships explicitly

Volar.js keeps explicit relationships between source scripts, associated scripts, virtual code, and mappings.

FeatureType likely needs an equivalent relationship layer for:

- feature to examples
- feature to anti-patterns
- feature to related features
- feature to source files
- feature to composed patterns
- feature to agent guidance

If these relationships stay implicit in prose only, the system will be much harder to query and keep current.

### D. Plan for both human-facing and machine-facing consumers

The repo handoff already hints that FeatureType may need to serve both humans and agents.

Volar.js shows one way to honor that:

- a low-level core for truth maintenance
- a service layer for capabilities
- multiple downstream consumers

For FeatureType, that could mean the same underlying knowledge supports:

- docs and explorer UIs for people
- linting and validation in CI
- inline editor help
- agent retrieval and action selection

### E. Keep the first implementation smaller than the vision

Volar.js works because its core boundary is tight.

FeatureType should probably avoid starting with:

- a full editor extension
- a complex custom file format
- a hosted product UI
- embeddings or ranking infrastructure as the first milestone

A better first slice is likely:

1. define the canonical entity model
2. ingest a few real examples
3. expose a query surface
4. prove that the answers are better than ad hoc repo search

## Concrete Idea Directions

### 1. FeatureType as a reusable-knowledge graph

Build the first core around explicit entities such as:

- feature
- example
- anti-pattern
- composition
- related feature
- provenance

This would make the system more like a truth-maintained graph than a loose documentation format.

### 2. FeatureType as a "usage language service"

Instead of focusing first on static documentation, FeatureType could answer usage questions:

- what component or pattern fits this intent?
- what are the canonical examples?
- what should not be used here?
- what are the nearby alternatives?
- what props, constraints, or workflow expectations matter?

That would align strongly with the original handoff language around discoverability and shared understanding.

### 3. FeatureType as a bridge between code reality and guidance

One especially promising direction is to make FeatureType track both:

- declared guidance
- observed usage in code

That opens the door to higher-value workflows such as:

- detect undocumented but common patterns
- detect guidance that has drifted from real usage
- propose missing examples
- flag anti-patterns that are becoming common

### 4. FeatureType as agent infrastructure, not just developer docs

The most differentiated version of the project may be agent-facing:

- a durable contract for what reusable things exist
- a structured description of when to use them
- a structured description of when not to use them
- examples that can be retrieved and ranked
- relationships that let an agent move from local context to the best reusable option

This feels closer to the repo's ambition than a plain documentation generator.

## Concrete End-To-End Flows

### Flow 1. An engineer is building UI and needs the right reusable thing

Example prompt or moment:

- "I need the right destructive action pattern for this settings page."
- "I need a search toolbar with filters and sort."

End-to-end flow:

1. The engineer, or an in-repo agent working for them, points FeatureType at the current file and local intent.
2. FeatureType resolves the most likely reusable options from its core graph.
3. The service returns a short, grounded answer:
   - the best-fit feature or pattern
   - the canonical examples
   - the important props or structural constraints
   - the nearby alternatives
   - the anti-patterns to avoid
4. The editor or agent inserts or adapts code from those sanctioned examples.
5. A validation pass confirms the chosen usage still matches known guidance.

What this means in practice:

- developers stop bouncing between repo search, Storybook, old PRs, and tribal memory
- agents stop guessing from fuzzy text matches
- the answer surface becomes "use this pattern, for these reasons, in this shape"

This is where the Volar.js influence becomes concrete: a reusable core and service boundary make it possible for the same answer to show up in editor tooling, agent tooling, and CLI flows without duplicating logic.

### Flow 2. A maintainer updates guidance and the whole system stays in sync

Example prompt or moment:

- "We now prefer `ConfirmDialog` for destructive actions."
- "This component supports a new compact mode and needs updated examples."

End-to-end flow:

1. A maintainer updates the authoritative FeatureType entry, the linked examples, or the source code examples that the entry points at.
2. `@featuretype/kit` re-ingests the changed records and updates the graph incrementally.
3. Validation checks fail fast if:
   - examples no longer compile
   - symbol links no longer resolve
   - related features point at removed or renamed artifacts
4. The updated knowledge becomes immediately available to every consumer:
   - docs or an explorer UI
   - editor assistance
   - agent retrieval
   - CI and governance jobs

This matters because FeatureType only becomes trustworthy if a maintainer can change one thing and know the system will stay consistent everywhere else.

### Flow 3. The repo drifts and FeatureType catches it before people normalize the wrong pattern

Example prompt or moment:

- "Why are people using this undocumented button variant everywhere?"
- "Our guidance says one thing, but the codebase seems to do another."

End-to-end flow:

1. A scheduled audit scans the codebase and compares observed usage with declared guidance.
2. FeatureType spots mismatches such as:
   - undocumented patterns that are becoming common
   - examples that no longer match real usage
   - anti-patterns spreading across the repo
   - components whose declared constraints are routinely violated
3. The audit produces a concrete report:
   - where the drift lives
   - which feature entries are stale
   - which code examples should be promoted, rewritten, or deprecated
4. A maintainer can then choose whether to bless the new pattern or drive the repo back toward the intended one.

This is one of the most compelling non-theoretical uses of a Volar-like architecture. The system is not just presenting docs. It is maintaining a living relationship between code reality and reusable knowledge.

### Flow 4. An agent is asked to implement a feature and needs better than grep

Example prompt or moment:

- "Add a repo search toolbar with query, saved view, filters, and sort."
- "Implement a destructive account deletion flow."

End-to-end flow:

1. The agent asks FeatureType for the best-fit feature or pattern set given the intent and the local code context.
2. FeatureType returns structured guidance such as:
   - the main feature or composed pattern
   - the sanctioned building blocks
   - examples from real code
   - required props, states, and relationships
   - warnings about invalid or discouraged compositions
3. The agent writes code using those grounded examples instead of inventing shapes from generic priors.
4. The agent runs a FeatureType validation step on the changed file or package.
5. If the result violates the known pattern contract, the agent revises before handing off.

This is where FeatureType starts to feel less like documentation and more like infrastructure for trustworthy automation.

### Flow 5. A human wants to understand the design system or architecture without reading the whole repo

Example prompt or moment:

- "What reusable search patterns do we already have?"
- "What is the difference between these two select components?"

End-to-end flow:

1. The human opens a CLI, browser workbench, or editor panel backed by the same core graph.
2. They browse or search by intent rather than only by symbol name.
3. FeatureType shows:
   - the feature definition
   - real examples
   - related patterns
   - anti-patterns
   - provenance back to code and docs
4. The person moves from confusion to a grounded choice without needing a teammate to explain the local lore.

This is the human-facing complement to the agent-facing flow. Both should use the same source of truth.

## A Realistic First Vertical Slice

The first useful version of FeatureType does not need to solve everything above.

A grounded first slice could be:

- one domain, such as a small component library or one reusable workflow family
- five to ten curated feature entries
- examples linked to real source files
- one Node-facing query command
- one validation or audit command
- one agent-facing lookup surface, likely through CLI or MCP before editor UI

Concrete example:

1. Curate a small set such as `Button`, `IconButton`, `ConfirmDialog`, `SearchToolbar`, and `SingleSelectCombobox`.
2. Record:
   - intent
   - canonical examples
   - important constraints
   - anti-patterns
   - related features
   - provenance to real files
3. Build:
   - `featuretype query "destructive action"`
   - `featuretype query "search toolbar with filters"`
   - `featuretype validate path/to/file.tsx`
   - `featuretype audit`
4. Prove that the answers are better than plain repo search for both a human and an agent.

If that slice works, then the next questions become much clearer:

- whether `.featuretype` should be the main authoring format
- whether editor integration is worth the complexity
- whether the knowledge model should stay lightweight or become more graph-like

## What Not To Import From Volar.js Too Early

Some Volar.js ideas are probably inspirational but premature for FeatureType right now:

- a full language-server-first posture
- sophisticated virtual-file machinery before there is a proven canonical model
- adapter packages before there is a real service boundary

The transferable lesson is the separation of concerns, not the exact tooling stack.

## Recommended Near-Term Path

1. Define a minimal core entity model for FeatureType.
2. Choose one narrow source domain to ingest first, such as a small component set or reusable workflow catalog.
3. Build one Node-facing query and validation surface before any editor integration.
4. Keep authoring syntax provisional until the internal model proves itself.
5. Add adapters only after the core and service boundaries feel stable.

## Open Questions

- What is the first concrete domain FeatureType should model?
- Is the first user a design-system maintainer, an application engineer, or an agent author?
- Should the first source of truth be handwritten entries, inferred code artifacts, or a hybrid?
- What are the minimum query shapes that would prove the system useful?
- How much of the first version needs strict structure versus permissive prose with extraction?

## Current Working Thesis

FeatureType should probably be treated less like a documentation format and more like a reusable-knowledge engine with multiple consumers.

That does not invalidate `.featuretype` files. It reframes them as one possible authoring or exchange surface on top of a stronger internal model.
