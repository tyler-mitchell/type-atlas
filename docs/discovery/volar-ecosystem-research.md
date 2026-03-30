# Volar Ecosystem Research

## Why This Note Exists

This note replaces the earlier lightweight Volar pass with a more source-based read of the current Volar ecosystem.

The goal is to understand:

- what `volarjs/volar.js` actually provides
- which adjacent repos represent the canonical implementation patterns
- which parts of the ecosystem are current versus legacy
- what that means for FeatureType before more implementation work continues

This note should be preferred over the earlier high-level Volar section when making architecture or implementation decisions.

For ongoing day-to-day extension work, prefer [`../implementation/featuretype-precedent-grounding.md`](../implementation/featuretype-precedent-grounding.md) as the implementation-facing guardrail document, and use this note as the broader research base behind it.

## Repos Reviewed

Research date: March 28, 2026.

Local snapshots were fetched from the current default branch of each repo using `giget`.

Repos inspected:

- `volarjs/volar.js`
- `volarjs/starter`
- `vuejs/language-tools`
- `withastro/language-tools`
- `volarjs/services`
- `volarjs/workspace` README via GitHub, to understand how the maintainers group the ecosystem

Freshness signals from GitHub API:

- `volarjs/volar.js`
  - default branch: `master`
  - pushed: March 5, 2026
- `volarjs/starter`
  - default branch: `master`
  - pushed: September 12, 2024
- `vuejs/language-tools`
  - default branch: `master`
  - pushed: March 26, 2026
- `withastro/language-tools`
  - default branch: `main`
  - pushed: November 17, 2025
  - note: the README says active development moved to the Astro monorepo
- `volarjs/services`
  - default branch: `master`
  - pushed: March 4, 2026

## Repo Roles

### `volarjs/volar.js`

This is the framework and primitive layer.

Its package split is the main architectural signal:

- `@volar/language-core`
- `@volar/language-service`
- `@volar/language-server`
- `@volar/vscode`
- `@volar/kit`
- `@volar/monaco`
- `@volar/typescript`

What it owns:

- virtual code generation and mappings
- language service composition
- LSP server scaffolding
- VS Code and Monaco adapters
- TypeScript plugin helpers
- Node-side checking and formatting helpers

What it does not own:

- domain-specific language logic for Vue, Astro, or other file types
- a canonical opinion about your project model
- your editor extension UX beyond thin transport and helper layers

### `volarjs/starter`

This is the canonical template for building a new embedded-language tool on top of Volar.

It is small, direct, and more representative of the intended extension path than the much more specialized Vue repo.

Its key pattern is:

1. define a custom `LanguagePlugin`
2. generate virtual code for the custom file type
3. use `createTypeScriptProject(...)` from `@volar/language-server/node`
4. compose domain-specific and generic language-service plugins
5. expose the result through a thin `@volar/vscode` client

The sample uses `.html1` files with embedded HTML, CSS, JavaScript, and TypeScript to show how the mapping model works in practice.

### `vuejs/language-tools`

This is the main production downstream and the most important mature reference.

Its repo structure makes the responsibilities clearer than the Volar.js root:

- `@vue/language-core`
- `@vue/language-service`
- `@vue/language-server`
- `@vue/typescript-plugin`
- `vue-tsc`
- `extensions/vscode`
- `test-workspace`

This is not a minimal template. It is the evolved shape for a language surface that needs:

- a custom source model
- many domain-specific language-service plugins
- a language server
- a TypeScript plugin
- a CLI tool
- a large fixture workspace and extensive protocol tests

### `withastro/language-tools`

This is a useful non-Vue downstream reference even though the repo README says development moved to the Astro monorepo.

It shows a production language server and TS plugin built on Volar, but with a smaller public surface than Vue's tooling stack.

The Astro repo is especially useful because it validates that the starter-like path scales beyond the tutorial case:

- custom language plugins
- `createTypeScriptProject(...)`
- custom language-service plugin collection
- a separate TS plugin when custom file support must participate in TS workflows

### `volarjs/services`

This repo still matters for context, but it should not be treated as the primary template for new work.

The README explicitly says these services were designed for the older Volar Language Features extension, version `< 2`, and are not compatible with the newer "Vue - Official" plugin.

That makes it a useful historical and service-library reference, but not the best starting point for FeatureType architecture.

### `volarjs/workspace`

The workspace repo is small, but strategically important.

Its README lists the repos the maintainers group together when developing Volar-based systems:

- `volarjs/volar.js`
- `volarjs/services`
- `volarjs/starter`
- `vuejs/language-tools`
- `withastro/language-tools`
- `mdx-js/mdx-analyzer`

That list is a strong hint about what the ecosystem considers current and adjacent.

## What Volar Is Actually Good At

The clearest throughline across these repos is that Volar is strongest when you need to maintain a truthful relationship between authored source and one or more derived or embedded language views.

The important capabilities are:

- custom file types or mixed-language files
- virtual code generation
- source-to-generated mappings
- embedded-language support
- composition of multiple language-service backends
- LSP exposure across editors
- TypeScript plugin collaboration when custom files need TS participation

In other words: Volar is primarily an embedded-language and virtual-code framework, not a generic editor-enhancement framework.

## Canonical Implementation Shapes

## 1. New embedded language surface: use the `starter` pattern

The `starter` repo is the cleanest reference for a fresh language/tooling project.

The pattern looks like:

1. create a `LanguagePlugin` that recognizes your file extension
2. generate a root `VirtualCode` plus any embedded codes
3. declare TypeScript extra service scripts if needed
4. create a Volar language server with `createTypeScriptProject(...)`
5. add generic services like HTML, CSS, Emmet, and TypeScript only where relevant
6. wrap it in a thin VS Code client using `@volar/vscode`

Important detail: the starter does not use `createSimpleProject(...)`.

It uses `createTypeScriptProject(...)`, which is a much stronger signal about the canonical path when TypeScript-aware project behavior matters.

## 2. Mature domain stack: split domain logic out of Volar primitives

Vue and Astro both show that once a domain grows, the right shape is not "put everything in the extension" and not "put everything in Volar primitives."

Instead, they split responsibilities:

- domain-specific language core
- domain-specific language-service plugins
- language server
- TypeScript plugin
- extension shell
- tests and fixture workspace

This means Volar remains the framework, but the domain model moves into its own packages.

For FeatureType, that is an important boundary lesson even if the project never becomes a full custom language.

## 3. TypeScript plugin support is a separate design choice

Both Vue and Astro use `createLanguageServicePlugin(...)` from `@volar/typescript`.

That path is for cases where:

- custom files must participate in TS imports
- rename and references need to cross TS and custom-file boundaries
- tsserver needs to understand generated or virtualized code

This is not automatically required just because a project uses Volar.

It is a separate decision that should be justified by actual TS integration needs.

## 4. Node and CI workflows are a first-class part of the ecosystem

`@volar/kit` exists because Volar-based systems are not only editor products.

Its role is to make diagnostics, formatting, and project watching usable in Node workflows.

Downstream repos also reinforce this pattern:

- `vue-tsc` in Vue
- `astro-check` in Astro
- test harnesses based on `@volar/test-utils`

This matters because a real Volar-based project usually grows at least one non-editor surface as soon as the core logic becomes valuable.

## What The Core Abstractions Mean In Practice

### `LanguagePlugin`

This is where a project teaches Volar how to recognize and transform its source material.

It can:

- detect language IDs
- create virtual code
- update virtual code incrementally
- expose TypeScript-relevant extra service scripts
- mark some files as associated-only in TS plugin mode

This is the domain-specific heart of a Volar integration.

### `VirtualCode` and mappings

This is where the real power lives.

A `VirtualCode` captures:

- the generated or embedded code snapshot
- the mapping back to source offsets
- embedded child codes
- feature flags for completion, diagnostics, navigation, formatting, and semantic behavior

If a product does not need this source-to-derived mapping model, it is probably not hitting Volar's main value.

### `LanguageServicePlugin`

This is the feature layer.

It provides editor behaviors such as:

- hover
- completions
- diagnostics
- code actions
- document links
- formatting

This layer sits on top of the language model. It is where product-specific IDE behavior is composed.

### `createTypeScriptProject(...)`

This is the project-aware server path.

It handles:

- tsconfig and jsconfig discovery
- inferred projects
- file watching and refresh
- TypeScript-backed language services
- project reuse across workspace files

For new embedded-language work, this appears to be the canonical language-server entry point when TS project semantics matter.

### `createSimpleProject(...)`

This exists, but it is the simpler path.

It wires a language service around currently open documents without the same TS project discovery and tsconfig behavior.

After reviewing the ecosystem more closely, it looks like a convenience path, not the main template for a serious new language surface.

## Testing Patterns Worth Reusing Later

The downstream repos are very consistent about testing:

- keep a real fixture workspace or test workspace in the repo
- start the language server in tests with `@volar/test-utils`
- open in-memory documents for protocol-level assertions
- test against real file-backed fixtures when project or tsconfig behavior matters
- use a TS server harness when the language server collaborates with a TS plugin

This is particularly visible in:

- `vuejs/language-tools/packages/language-server/tests/server.ts`
- `vuejs/language-tools/test-workspace`
- `withastro/language-tools/packages/language-server/test/server.ts`
- `withastro/language-tools/packages/language-server/test/fixture`

For FeatureType, that suggests any future Volar-based experiment should be evaluated with a fixture workspace and protocol-level tests early, not only by ad hoc manual editor behavior.

## What This Means For FeatureType

## 1. Volar is not automatically the right foundation

The previous lighter pass made it too easy to think of Volar as a general platform for editor assistance.

That is not the strongest reading of the ecosystem.

The strongest reading is:

- Volar is excellent when the product owns a language surface or mixed-language document model
- Volar is much less obviously necessary for plain catalog lookup over ordinary TSX files

If FeatureType remains "guidance over existing React or TSX code," then a normal VS Code extension, TS integration, or agent service may be a more natural starting point.

## 2. Volar becomes compelling when FeatureType commits to a real language boundary

A Volar-based FeatureType starts to make architectural sense if FeatureType becomes one of these:

- a first-class `.featuretype` file type with embedded code examples and structured sections
- a system that generates virtual documents from `.featuretype` records and maps them back to source examples
- a cross-file TS-aware system where `.featuretype` and TSX participate in references, rename, or import-related flows
- a mixed-language authoring environment where catalog entries contain embedded TSX, Markdown, or config regions that need real IDE services

Those are genuine Volar-shaped problems.

## 3. The cleanest Volar path for FeatureType, if it exists, would look more like `starter` than like Vue

If FeatureType does become a real custom file or embedded-language surface, the likely first shape should be:

- one custom `LanguagePlugin`
- `createTypeScriptProject(...)`
- a small set of language-service plugins
- a thin VS Code client
- a fixture workspace and LSP tests

Vue's architecture is valuable, but it is already a mature ecosystem shape, not the right first move for a new project.

## 4. The older `services` repo should not drive the architecture

The compatibility note in `volarjs/services` is too important to ignore.

It is still useful as a catalogue of service ideas, but it should not be treated as the authoritative starting point for a new Volar integration in 2026.

## Current Working Conclusion

The main architectural question for FeatureType is no longer "How do we add Volar?"

It is:

"Does FeatureType truly have a language or virtual-document problem?"

If the answer is no, forcing Volar in early would likely distort the product.

If the answer is yes, the most credible implementation path is:

- start from the `starter` pattern
- model a real `.featuretype` language boundary
- use `createTypeScriptProject(...)`, not `createSimpleProject(...)`, as the default server path
- defer Vue-level complexity until the product proves it needs that level of specialization

## Follow-Up Questions Before More Implementation

- Is `.featuretype` intended to become a true first-class authored file type?
- Will `.featuretype` contain embedded TSX or other language regions that need mapped IDE services?
- Does FeatureType need cross-file TS participation, or only catalog lookup and editor commands?
- Is the next proof about authoring a new language surface, or about querying a guidance catalog from ordinary TSX?

Those questions should be resolved before treating Volar as a firm dependency rather than a possible fit.
