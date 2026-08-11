# @type-atlas/core

## 0.3.0

### Patch Changes

- 4314ad0: Keep a workspace's language server alive across the gaps between an agent's
  calls. The idle window was 60 seconds, which suits an editor but not an agent:
  agents reason between tool calls and interleave reads, edits, and shell
  commands, so the window expired constantly and the next call rebuilt the whole
  TypeScript program.

  Measured on this repository, a call following a 65 second pause took 1625ms and
  now takes 25ms. Calls made in quick succession were already fast and are
  unchanged.

- 37d55e3: Return document links an agent can act on. Markdown links pointing at a
  directory, or at a file with a fragment, were resolved into VS Code command
  URIs such as
  `command:revealInExplorer?[{"$mid":1,"fsPath":"…","external":"file:///…"}]` —
  editor-host instructions that mean nothing outside a VS Code window and cost
  roughly 240 characters each.

  The resource is now recovered from the command payload, so a link to
  `packages/mcp` renders as `packages/mcp`. `document_links` on this repository's
  README drops from 1,279 to 515 characters with all nine links intact. A command
  target whose resource cannot be recovered is omitted, since an agent has no host
  on which to run it.

  `vscode-markdown-languageservice` hardcodes these command URIs with no option to
  suppress them, and its plain-target `resolveLinkTarget` API is not surfaced by
  `volar-service-markdown`, so the encoding is reversed on the returned links.

- 0a8369e: Exclude generated declarations from `workspace_symbols`. A workspace package
  consumed through its build output reported the generated declaration next to
  the source it was generated from, so searching `inspectSymbol` in this
  repository returned eight results where four were `dist` duplicates of the
  other four.

  TypeScript's navigate-to API accepts `excludeDtsFiles`, but
  `volar-service-typescript` calls it with only the query and exposes no setting
  for that argument, so the equivalent selection is applied to the returned
  locations.

  - @type-atlas/language-server@0.3.0

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
