# @type-atlas/core

## 0.2.0

### Minor Changes

- 3213a38: This release is breaking. Honor project-configured TypeScript language-service plugins, including the Effect language service, and make the diagnostics tool inspect the selected TypeScript project by default. Project diagnostics reuse the selected Volar project, remain silent when clean, page agent-facing output, refresh automatically after filesystem changes, and preserve cancellation and timeout behavior. Normal file tools continue to surface one complete ambient error or warning without promoting a redundant file-diagnostics call. Native LSP resolution and concurrent dependency operations no longer depend on process-wide request queues. Agent-facing source coordinates are now consistently one-based, and `list_files` accepts either one glob pattern or an array.

### Patch Changes

- b86e04c: Keep the code fence that separates a declaration from its documentation in
  hover output. Hover markup carries both a signature and prose, and stripping the
  fence ran them together as one block, so `hover`, `inspect_symbol`, and
  `explore_symbol` gave no cue for where the declaration ended and the doc comment
  began. Documentation-only markup in signature help, completions, module exports,
  and inlay hints is still rendered as plain prose.
- 31f4b09: Keep workspace symbol search focused on source-code results and bound rendered symbol labels so unrelated language-provider output cannot flood agent context.
- Updated dependencies [3213a38]
  - @type-atlas/language-server@0.2.0

## 0.1.1

### Patch Changes

- @type-atlas/language-server@0.1.1

## 0.1.0

### Minor Changes

- 243c9e5: Establish the Type Atlas package suite and its production release toolchain.
- 23f75a1: Publish the suite under the `@type-atlas` scope with a cross-platform
  `type-atlas` executable, one-command client installation, verified package
  contents, and official MCP Registry discovery.
- 23f75a1: Add bounded, Windows-safe workspace structure navigation and harden
  code-intelligence, dependency-discovery, editing, freshness, and agent-facing
  output behavior for production repository use.

### Patch Changes

- Updated dependencies [243c9e5]
- Updated dependencies [23f75a1]
- Updated dependencies [23f75a1]
  - @type-atlas/language-server@0.1.0
