# FeatureType Precedent Grounding

## Why This Exists

FeatureType is intentionally exploring `.featuretype` as a first-class authored language with embedded code, not just a prettier documentation format.

That makes precedent unusually important. The wrong move is not just an ugly implementation. It is building the language surface around the wrong layer and creating drift that future agents then amplify.

This note is the implementation-facing control-plane document for staying grounded. Use it before changing the `.featuretype` document model, the Volar integration, the VS Code extension surface, or editor behavior adjacent to syntax and authoring.

Use this note together with:

- [`../discovery/volar-ecosystem-research.md`](../discovery/volar-ecosystem-research.md) for the broader upstream research pass
- [`./featuretype-vscode-mvp.md`](./featuretype-vscode-mvp.md) for what is currently implemented and validated in this repo

## What This Doc Governs

This note governs:

- `.featuretype` as an authored mixed-language surface
- Volar architecture decisions
- VS Code extension structure
- syntax highlighting, snippets, language configuration, and adjacent authoring assets
- the conditions under which FeatureType should adopt deeper language-server or TypeScript-plugin behavior

This note does not govern:

- broader product strategy
- catalog or CLI-first workflows
- future agent features that do not affect the language or authoring architecture

## Precedent Stack

The current precedence order should stay explicit.

| Precedent | Use It For | Do Not Copy Blindly |
| --- | --- | --- |
| [`volarjs/starter`](https://github.com/volarjs/starter) | Default shape for a new Volar-backed file type: thin VS Code client, `createTypeScriptProject(...)`, language plugin, service composition, and Labs-friendly wiring | Its sample language is tiny and intentionally incomplete. Do not mistake "minimal example" for "finished product architecture." |
| [`withastro/language-tools`](https://github.com/withastro/language-tools) | Production precedent for a custom file type that keeps grammar assets, snippets, language configuration, and the Volar server cleanly separated | Astro-specific commands, settings, and content-intellisense are product decisions, not default requirements for FeatureType. |
| [`mdx-js/mdx-analyzer`](https://github.com/mdx-js/mdx-analyzer) | Document-centric authored surfaces, Volar Labs integration, and mixed authoring behavior where the source file is not "just code" | MDX's Markdown semantics and validation model are not a template for `.featuretype` structure. |
| [`vuejs/language-tools`](https://github.com/vuejs/language-tools) | Mature split between language core, language service, language server, TS plugin, extension assets, semantic tokens, and injection grammars | Vue is the "scale-up" precedent. Do not jump to Vue-sized surface area unless FeatureType has proven need. |
| [`sveltejs/language-tools`](https://github.com/sveltejs/language-tools) | Generated grammar assets, grammar build steps, and grammar-test discipline | Svelte's older build choices are not automatically a fit for this repo. Borrow the pattern, not the exact tooling stack. |

## What FeatureType Should Borrow Now

These patterns are grounded enough to be treated as default behavior.

### 1. Keep the extension thin

Borrow from `volarjs/starter`, Astro, and MDX:

- keep the VS Code extension focused on transport, packaging, language contributions, and Volar Labs wiring
- keep `.featuretype` parsing, mappings, and semantics out of the extension shell
- use `@volar/vscode` helpers such as `createLabsInfo(...)` and `getTsdk(...)` instead of reimplementing the client lifecycle

### 2. Keep syntax and semantics separate

Borrow from Astro, Vue, and Svelte:

- TextMate grammar owns visible structure and embedded language dispatch
- language configuration owns pairing, comments, indentation, and folding behavior
- snippets own scaffolded authoring ergonomics
- Volar owns diagnostics, hover, symbols, code actions, mappings, and future semantic intelligence

FeatureType should not try to make the grammar perform semantic work.

### 3. Keep `.featuretype` language growth schema-first

Borrow from the current registry-driven implementation, not from ad hoc extension commands.

When adding a new `.featuretype` capability:

1. extend the block schema in [`packages/core/src/schema.ts`](/Users/tylermitchell/Projects/featuretype/packages/core/src/schema.ts)
2. keep parsing and block ranges in [`packages/core/src/parseFeatureDocument.ts`](/Users/tylermitchell/Projects/featuretype/packages/core/src/parseFeatureDocument.ts)
3. let the syntax asset generator derive block tags and embedding rules from the schema
4. let the Volar service layer pick up the new block from shared metadata where possible

This is the main anti-drift rule for future agents: add language capabilities by extending the document model, not by sprinkling one-off editor behavior around the repo.

### 4. Treat generated grammar assets as normal

Borrow from Svelte and Astro:

- it is acceptable for the shipped grammar JSON to be generated
- generation is especially justified when the grammar needs to stay aligned with a live schema
- the generated artifact should stay narrow in purpose: block tags, attributes, structural scopes, and embedded language routing

The generator should not become a second parser or a second semantic system.

### 5. Keep mixed-language value tied to authored blocks

Borrow from Volar's actual strengths:

- embedded code should come from explicitly authored `.featuretype` blocks such as `<setup>`, `<recipe>`, and `<showcase>`
- virtual files should preserve clear names and mappings so Volar Labs remains useful during debugging
- TypeScript diagnostics should map back to the original `.featuretype` source instead of forcing the author to reason about generated files

This keeps the language valuable for humans and agents in the same way.

## What FeatureType Should Avoid For Now

These are the most likely ways future work can drift.

### 1. Do not move language logic into the extension shell

Avoid:

- parser logic in `apps/vscode-extension`
- custom document understanding implemented only as VS Code commands
- extension-only behavior that bypasses the shared `.featuretype` language model

If a capability matters to `.featuretype`, it should usually live in `packages/core`, `packages/service`, or later a dedicated language package.

### 2. Do not use TextMate as a semantic engine

Avoid:

- encoding business rules in regex-heavy grammar logic
- relying on scope hacks to simulate real diagnostics
- pushing authoring intelligence into syntax rules just because it is visually convenient

If the behavior needs understanding, it belongs in the Volar service layer.

### 3. Do not introduce a TypeScript plugin just because Volar supports one

Vue and Astro both prove that TS plugin support is real and useful, but it is not the default next step.

Do not add a TS plugin until FeatureType genuinely needs one of these:

- `.featuretype` symbols participating in TS imports
- rename or references across `.featuretype` and `.tsx`
- TS-aware operations that must start from ordinary TS files and understand FeatureType-generated code

Until then, the language server plus virtual service scripts are the simpler and more grounded shape.

### 4. Do not jump to Vue-scale complexity early

Avoid prematurely adding:

- semantic-token layers for every block kind
- multiple injection grammars
- wide extension command surfaces
- extra packages whose only job is speculative future flexibility

FeatureType should scale into those patterns only when the authored language surface proves the need.

### 5. Do not let `.featuretype` devolve into passive prose again

The point of this project is not "better notes."

Avoid changes that reduce `.featuretype` to:

- untyped example blobs
- freeform prose with weak structure
- editor features that work only on downstream TSX files while `.featuretype` remains second-class

The authored `.featuretype` file is the primary artifact.

## When To Scale Up

These are the honest triggers for deeper precedent adoption.

### Adopt Vue-style semantic tokens when:

- TextMate scopes are no longer enough to distinguish important block roles
- authors need richer visual meaning than block-tag highlighting can convey
- the extra semantics are derived from the parsed document, not from regex guesses

### Adopt Vue- or Astro-style TS plugin behavior when:

- `.featuretype` participates in cross-file rename, references, imports, or TS project graphs
- ordinary TS or TSX authoring must understand FeatureType-defined symbols

### Adopt MDX- or Vue-style injection grammars when:

- `.featuretype` needs to live inside Markdown, MDX, or another host document
- FeatureType-specific authored blocks must be highlighted inside another language surface

### Adopt `@volar/kit` or checker-style workflows when:

- authors need CI or local validation outside VS Code
- the same diagnostics that appear in the editor need to run in Node workflows

## Stable Architecture Boundaries

Future agents should try to preserve these boundaries.

### `packages/core`

Owns:

- the `.featuretype` document schema
- parsing
- block ranges and hierarchy
- extension hooks for new block types

Should not own:

- VS Code transport concerns
- UI-facing extension lifecycle

### `packages/service`

Owns:

- Volar language plugin behavior
- virtual files and service scripts
- FeatureType diagnostics, hover, symbols, and code actions

Should not own:

- grammar JSON
- language configuration
- extension packaging concerns

### `packages/language-server`

Owns:

- project creation with `createTypeScriptProject(...)`
- server bootstrap
- service composition

Should not own:

- `.featuretype` authoring rules that belong in the shared core or service packages

### `apps/vscode-extension`

Owns:

- activation
- language contributions
- grammar, snippets, and language configuration assets
- VSIX packaging
- Volar Labs integration

Should not own:

- the only implementation of FeatureType semantics

## Development Protocol For Future Agents

Use this sequence before making language-facing changes.

1. Classify the change.
   Is it a document-model change, a syntax/asset change, a Volar semantic change, or a TS-integration change?
2. Check precedent before coding.
   Use the closest repo in the precedence stack first instead of free-handing.
3. Change the lowest truthful layer.
   If the authored language changed, start in `packages/core`. If editor rendering changed, start in extension assets. If semantics changed, start in `packages/service`.
4. Keep generation one-way.
   Generated syntax assets may derive from the schema, but the shipped grammar must not become the source of truth.
5. Validate in the real loop.
   Prefer repo tests plus live VS Code Insiders validation with Volar Labs whenever the change affects language behavior.
6. Update the docs that future agents will actually read.
   Keep this note, the MVP note, and the README aligned.

## Short Decision Rules

If the question is "where should this capability live?", default to these answers:

- new `.featuretype` block or attribute: `packages/core`
- new code-bearing authored block: `packages/core`, then `packages/service`
- syntax coloring or embedded language dispatch: extension grammar and language configuration
- structural diagnostics, hover, symbols, or code actions: `packages/service`
- server bootstrap or TypeScript project setup: `packages/language-server`
- VS Code activation, packaging, or Labs wiring: `apps/vscode-extension`
- cross-file TS intelligence that starts from ordinary TS or TSX files: consider a future TS plugin, but only with a proven need

## What Success Looks Like

FeatureType stays grounded when future agents can answer these questions cleanly:

- Is `.featuretype` still the primary authored artifact?
- Is the change anchored in an actual upstream precedent?
- Is the logic placed in the right layer?
- Can the language still be debugged through Volar Labs?
- Can a future agent extend the language by following the schema-first path instead of inventing a parallel system?

If the answer to any of those becomes unclear, stop and re-ground the change before expanding the architecture.
