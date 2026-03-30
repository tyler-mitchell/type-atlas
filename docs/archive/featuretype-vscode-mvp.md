# FeatureType VS Code MVP

## Goal

Prove that `.featuretype` can be a first-class authored language surface in VS Code, with embedded code that stays typechecked and editor-aware through Volar.js.

The MVP is no longer centered on a narrow `<examples>` shape. The current foundation treats `.featuretype` as a registry-driven authored document format where top-level and nested blocks can evolve over time without rewriting the language architecture.

For the ongoing precedent and anti-drift rules future agents should follow while extending this foundation, see [`./featuretype-precedent-grounding.md`](./featuretype-precedent-grounding.md).

## What Is True Now

The repo currently ships a working Volar-based VS Code extension that:

- recognizes `.featuretype` as its own language
- parses documents through a schema-backed block registry
- emits virtual TypeScript files for authored code-bearing blocks such as `<recipe>` and `<showcase>`
- maps TypeScript diagnostics back to the original `.featuretype` source
- surfaces FeatureType structural diagnostics, document symbols, hover, and code actions from the same schema
- ships syntax highlighting, embedded TS and TSX coloring, and snippets for `.featuretype`
- works in VS Code Insiders and exposes its virtual files and service plugins through Volar Labs

## Upstream Shape Followed

This implementation deliberately follows the Volar starter path for VS Code extensions instead of inventing a custom architecture:

- `volarjs/starter`
  - thin `@volar/vscode` client
  - `createLabsInfo(...)`
  - bundled VSIX via `esbuild`
  - language server built around `createTypeScriptProject(...)`

For implementation choices not prescribed directly by the starter, adjacent ecosystem repos were used as references before adding custom behavior:

- `withastro/language-tools`
  - thin VS Code shell
  - production `createTypeScriptProject(...)` language server
  - custom language-service plugin composition
- `mdx-js/mdx-analyzer`
  - mixed authored document surface
  - custom Volar language plugin and service plugin
  - Volar Labs integration in a real extension

## Package Layout

### `packages/core`

Owns the `.featuretype` document model and schema.

Current responsibilities:

- define a registry-driven block schema in [`packages/core/src/schema.ts`](/Users/tylermitchell/Projects/featuretype/packages/core/src/schema.ts)
- parse top-level and nested blocks into a structural tree
- retain precise source ranges for each block
- emit code-bearing blocks for Volar service scripts
- expose `extendFeatureDocumentSchema(...)` so future capabilities can be added without changing the parser architecture

### `packages/service`

Owns the Volar-facing language logic.

Current responsibilities:

- `createFeatureTypeLanguagePlugin(...)`
  - recognizes `.featuretype`
  - creates a root `FeatureTypeVirtualCode`
  - emits one TS or TSX extra service script per code-bearing block with `emitServiceScript: true`
- `createFeatureTypeServicePlugin(...)`
  - structural diagnostics
  - document symbols derived from the parsed block tree
  - hover text on FeatureType tags
  - code actions derived from block templates in the schema

### `packages/language-server`

Owns the language server process.

Current responsibilities:

- load the TypeScript SDK from VS Code initialization options
- create a Volar project with `createTypeScriptProject(...)`
- register the FeatureType language plugin
- compose TypeScript services plus the custom FeatureType service plugin

### `apps/vscode-extension`

Owns the editor shell.

Current responsibilities:

- start the bundled server through `@volar/vscode`
- resolve the active TypeScript SDK with `getTsdk(...)`
- expose Volar Labs integration with `createLabsInfo(...)`
- contribute a generated TextMate grammar plus language configuration and snippets
- package the client and server into a self-contained VSIX

## Registry-Driven `.featuretype` Foundation

The current document model is intentionally shaped so agents can expand `.featuretype` over time.

The default schema currently includes:

- text blocks such as `<intent>`, `<anatomy>`, `<constraints>`, `<related>`, `<tokens>`, `<decisions>`, `<checklist>`, and `<status>`
- code blocks such as `<setup>`, `<recipe>`, and `<showcase>`
- a legacy container `<examples>` with nested `<example>` blocks

Important architectural choices:

- blocks are declared through schema definitions, not hardcoded parser branches
- container blocks can declare child block definitions
- code-bearing blocks declare their language and shape through schema metadata
- insertion templates also live in the schema, so editor scaffolding follows the registry
- unknown blocks are surfaced as warnings, which keeps typos visible while preserving a clean path for deliberate schema extension

The extension point for future capabilities is `extendFeatureDocumentSchema(...)`. A future agent-capability block can be added by extending the schema, and the same parser plus Volar service stack will pick it up.

## Current Authored Shape

The richer fixture at [`fixtures/demo-workspace/single-select-combobox.featuretype`](/Users/tylermitchell/Projects/featuretype/fixtures/demo-workspace/single-select-combobox.featuretype) is the current best example of the intended authoring model:

```featuretype
<intent>
  Single-select combobox for toolbar filter controls.
  Owns: popup open state, keyboard navigation, option filtering.
  Caller provides: value, onValueChange, options array (stable reference).
</intent>

<anatomy>
  SingleSelectCombobox
    > ComboboxTrigger
    > ComboboxContent
      > ComboboxInput
      > ComboboxOption[]
</anatomy>

<setup lang="ts">
import { useState } from "react"
import { SingleSelectCombobox } from "./components"
</setup>

<recipe id="minimal-controlled" intent="controlled single-select with local state">
  function MinimalControlledCombobox() {
    // ...
  }
</recipe>

<showcase id="toolbar-composition" title="In-App Filter Toolbars" controls>
  function ToolbarShowcase({ size, variant }) {
    // ...
  }
</showcase>
```

The important point is that `<recipe>` and `<showcase>` are not inert snippets. They are author-time language regions that become virtual TSX files.

## Virtual Code Model

Each `.featuretype` file creates:

- one root virtual code with an identity mapping over the full source document
- one embedded service script for every code-bearing block whose schema definition has `emitServiceScript: true`

Today that means:

- top-level `<recipe>` blocks become virtual TSX modules
- top-level `<showcase>` blocks become virtual TSX modules
- legacy nested `<example>` blocks still become virtual TSX fragments wrapped in a generated function

`<setup>` is prepended into every generated service script, which lets authored code blocks share imports and helpers while still mapping diagnostics back into the original document.

## Syntax Highlighting And Adjacent Editor Assets

The extension now ships a TextMate grammar at [`apps/vscode-extension/syntaxes/featuretype.tmLanguage.json`](/Users/tylermitchell/Projects/featuretype/apps/vscode-extension/syntaxes/featuretype.tmLanguage.json) that is generated from the default block schema by [`apps/vscode-extension/scripts/generateSyntaxAssets.ts`](/Users/tylermitchell/Projects/featuretype/apps/vscode-extension/scripts/generateSyntaxAssets.ts).

That generation step keeps the editor surface aligned with the language model:

- known `.featuretype` block tags are highlighted from the same registry used by the parser
- attributes and block metadata are tokenized consistently
- text sections such as checklists, bullet constraints, anatomy connectors, labels, and token declarations receive light structural highlighting
- embedded `<setup>`, `<recipe>`, `<showcase>`, and legacy `<example>` regions inherit TypeScript or TSX coloring through `embeddedLanguages`

Adjacent editor assets now include:

- [`apps/vscode-extension/language-configuration.json`](/Users/tylermitchell/Projects/featuretype/apps/vscode-extension/language-configuration.json) for comments, indentation, folding markers, and bracket behavior
- [`apps/vscode-extension/languages/featuretype.code-snippets`](/Users/tylermitchell/Projects/featuretype/apps/vscode-extension/languages/featuretype.code-snippets) for full document, setup, recipe, and showcase scaffolds

## What Is Validated

The MVP is currently proven in three layers.

### Core schema tests

[`packages/core/src/parseFeatureDocument.test.ts`](/Users/tylermitchell/Projects/featuretype/packages/core/src/parseFeatureDocument.test.ts) verifies:

- legacy nested `<example>` extraction
- top-level `<recipe>` and `<showcase>` extraction
- custom schema extension via a nested `agent-capability` block
- structural diagnostics for missing required blocks and attributes

### Protocol-level language-server tests

[`packages/language-server/test/diagnostics.test.ts`](/Users/tylermitchell/Projects/featuretype/packages/language-server/test/diagnostics.test.ts) verifies that:

- [`fixtures/demo-workspace/broken-button.featuretype`](/Users/tylermitchell/Projects/featuretype/fixtures/demo-workspace/broken-button.featuretype) returns:
  - a mapped TypeScript error for `tone="destructive"`
  - a FeatureType structural error for the missing `<intent>` block
- [`fixtures/demo-workspace/broken-single-select-combobox.featuretype`](/Users/tylermitchell/Projects/featuretype/fixtures/demo-workspace/broken-single-select-combobox.featuretype) returns:
  - a mapped TypeScript error for the invalid `selectedValue` prop inside a top-level `<recipe>`

### Live VS Code Insiders validation

The extension was freshly packaged and installed into an isolated VS Code Insiders profile on March 29, 2026, then inspected with Volar Labs.

Observed live signals:

- the exthost log at [`/tmp/featuretype-vscode-insiders-user/logs/20260329T000752/window1/exthost/exthost.log`](/tmp/featuretype-vscode-insiders-user/logs/20260329T000752/window1/exthost/exthost.log#L5) shows activation on `onLanguage:featuretype`
- opening [`fixtures/demo-workspace/broken-single-select-combobox.featuretype`](/Users/tylermitchell/Projects/featuretype/fixtures/demo-workspace/broken-single-select-combobox.featuretype) showed `Errors: 1` in the status bar, matching the expected top-level `<recipe>` TypeScript error
- Volar Labs showed:
  - `FeatureType Language Server`
  - the root virtual file
  - `recipe_broken_controlled` for the broken top-level recipe document
  - `recipe_minimal_controlled` and `showcase_toolbar_composition` for [`fixtures/demo-workspace/single-select-combobox.featuretype`](/Users/tylermitchell/Projects/featuretype/fixtures/demo-workspace/single-select-combobox.featuretype)
  - the custom `featuretype` service plugin alongside the TypeScript plugins

An additional live syntax pass was validated in a fresh VS Code Insiders profile on March 29, 2026:

- the exthost log at [`/tmp/featuretype-vscode-insiders-user-syntax/logs/20260329T002214/window1/exthost/exthost.log`](/tmp/featuretype-vscode-insiders-user-syntax/logs/20260329T002214/window1/exthost/exthost.log#L5) shows activation on `onLanguage:featuretype`
- the packaged VSIX included the shipped grammar and snippet assets
- a live screenshot at [`/tmp/featuretype-syntax-highlighting.png`](/tmp/featuretype-syntax-highlighting.png) shows block tags, attributes, structural text sections, and embedded TypeScript or TSX coloring working together in the editor

## Commands

Build everything:

```bash
pnpm build
```

Run checks:

```bash
pnpm check-types
pnpm test
```

Package the extension:

```bash
pnpm --filter featuretype-language-features run pack
```

Install into VS Code Insiders:

```bash
'/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code' \
  --install-extension '/Users/tylermitchell/Projects/featuretype/apps/vscode-extension/dist/featuretype-language-features.vsix' \
  --force
```

Install Volar Labs:

```bash
'/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code' \
  --install-extension johnsoncodehk.volarjs-labs \
  --force
```

## Agent-Relevant Foundation

This MVP now supports the right direction for agent expansion:

- agents can add new top-level or nested blocks by extending the schema instead of rewriting the parser
- if a new block is code-bearing, it can become a typed virtual file through schema metadata alone
- hover, symbols, required-block diagnostics, and insertion scaffolds can follow the schema automatically
- legacy `<examples>` remain supported, but they are no longer the architectural center

## Honest Current Limits

The authoring foundation is real, but the language is still early.

What is proven:

- registry-driven document parsing
- schema extension in tests
- top-level typed `<recipe>` and `<showcase>` virtual files
- structural diagnostics
- Volar Labs visibility
- bundled VSIX working in VS Code Insiders

What exists in code but was not yet deeply exercised in the live editor:

- richer hover quality beyond block descriptions
- document-symbol ergonomics for very large documents
- the authoring usefulness of every generated code action

What is intentionally deferred:

- completions tailored to FeatureType structure
- richer grammar and syntax-highlighting polish
- TypeScript plugin participation across imports, rename, and references
- agent-specific execution workflows inside `.featuretype`
