# FeatureType

FeatureType is exploring `.featuretype` as a first-class authored language for reusable feature guidance, with embedded code that stays typechecked and editor-aware through Volar.js.

The repository now contains a working VS Code MVP centered on a registry-driven `.featuretype` foundation rather than a one-off examples format.

Current source-of-truth docs:

- [`featuretype-project-init.handoff.md`](./featuretype-project-init.handoff.md) for the original framing and constraints
- [`docs/discovery/volar-ecosystem-research.md`](./docs/discovery/volar-ecosystem-research.md) for the upstream and adjacent-repo research pass that shaped the implementation
- [`docs/implementation/featuretype-precedent-grounding.md`](./docs/implementation/featuretype-precedent-grounding.md) for the durable "how to extend this without drift" guide anchored in Volar ecosystem precedent
- [`docs/implementation/featuretype-vscode-mvp.md`](./docs/implementation/featuretype-vscode-mvp.md) for the actual MVP architecture, package layout, and validation flow
- [`docs/discovery/onboarding-and-volarjs-ideation.md`](./docs/discovery/onboarding-and-volarjs-ideation.md) for the earlier broader ideation trail

## Current Repo State

The repo is no longer just a scaffold. It currently contains:

- `packages/core`
  - parses `.featuretype` documents into a schema-backed structural model
- `packages/service`
  - provides the Volar language plugin and FeatureType service plugin
- `packages/language-server`
  - hosts the Volar language server with `createTypeScriptProject(...)`
- `apps/vscode-extension`
  - bundles a thin VS Code client and server into a self-contained VSIX
- `fixtures/demo-workspace`
  - provides demo `.featuretype` files and TSX components for validation

## MVP Capabilities

- `.featuretype` files are recognized as a first-class language
- top-level code-bearing blocks such as `<recipe>` and `<showcase>` are converted into virtual code and typechecked through Volar + TypeScript
- legacy nested `<example>` blocks remain supported
- TypeScript diagnostics map back onto the authored `.featuretype` file
- structural diagnostics are surfaced for missing required sections such as `<intent>`
- syntax highlighting is generated from the default block schema, including embedded TS and TSX coloring
- snippets are included for full documents plus setup, recipe, and showcase blocks
- hover, document symbols, and insertion code actions are driven from the same block schema
- the schema can be extended so future `.featuretype` capabilities do not require parser rewrites
- Volar Labs can inspect the FeatureType language server, virtual files, and registered service plugins

## Quick Start

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter featuretype-language-features run pack
```

For a real editor validation loop, use VS Code Insiders plus the Volar Labs extension:

1. install the packaged VSIX from `apps/vscode-extension/dist/featuretype-language-features.vsix`
2. install [`johnsoncodehk.volarjs-labs`](https://marketplace.visualstudio.com/items?itemName=johnsoncodehk.volarjs-labs)
3. open [`fixtures/demo-workspace/single-select-combobox.featuretype`](./fixtures/demo-workspace/single-select-combobox.featuretype)
4. expect the file to render with highlighted block tags, attributes, and embedded code
5. in Volar Labs, expect separate virtual files for:
   - `recipe_minimal_controlled`
   - `showcase_toolbar_composition`
6. open [`fixtures/demo-workspace/broken-single-select-combobox.featuretype`](./fixtures/demo-workspace/broken-single-select-combobox.featuretype)
7. expect a mapped TypeScript error for the invalid `selectedValue` prop inside the top-level `<recipe>` block

The detailed validation evidence and architecture notes live in [`docs/implementation/featuretype-vscode-mvp.md`](./docs/implementation/featuretype-vscode-mvp.md).

For the guardrails future agents should follow before extending the language or editor surface, see [`docs/implementation/featuretype-precedent-grounding.md`](./docs/implementation/featuretype-precedent-grounding.md).
