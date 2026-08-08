# @type-atlas/mcp

## 0.2.0

### Minor Changes

- 3213a38: This release is breaking. Honor project-configured TypeScript language-service plugins, including the Effect language service, and make the diagnostics tool inspect the selected TypeScript project by default. Project diagnostics reuse the selected Volar project, remain silent when clean, page agent-facing output, refresh automatically after filesystem changes, and preserve cancellation and timeout behavior. Normal file tools continue to surface one complete ambient error or warning without promoting a redundant file-diagnostics call. Native LSP resolution and concurrent dependency operations no longer depend on process-wide request queues. Agent-facing source coordinates are now consistently one-based, and `list_files` accepts either one glob pattern or an array.
- f52fc36: Ship server-level usage instructions and trim server metadata.

  The server now sends MCP `instructions` describing one-based coordinates, the
  role of `workspace` in selecting a language-server session, `inspect_symbol` as
  the default entry point for understanding a symbol, the project boundary that
  bounds reference results, and the semantic-not-textual nature of the retrieval
  tools. Tool descriptions for `search_code`, `references`, and the `workspace`
  input carry the same corrections, so agents stop treating scoped reference
  results as complete usage audits and stop using semantic search for exact
  strings.

  The server icon is now referenced by URL rather than embedded as a `data:` URI,
  which drops the advertised metadata from roughly 7.9 kB to under 400 bytes on
  every initialize. Clients that cannot fetch the icon render none.

### Patch Changes

- b86e04c: Keep the code fence that separates a declaration from its documentation in
  hover output. Hover markup carries both a signature and prose, and stripping the
  fence ran them together as one block, so `hover`, `inspect_symbol`, and
  `explore_symbol` gave no cue for where the declaration ended and the doc comment
  began. Documentation-only markup in signature help, completions, module exports,
  and inlay hints is still rendered as plain prose.
- 31f4b09: Keep workspace symbol search focused on source-code results and bound rendered symbol labels so unrelated language-provider output cannot flood agent context.
- 94dbcb4: Keep `explore_symbol` usable when semantic retrieval is unavailable. A failing
  similarity provider previously discarded the completed language-server
  inspection and returned only the provider error, so an environment without `uv`
  lost definitions, implementations, callers, calls, and references for every
  explored symbol. The inspection is now returned with a short note explaining why
  the related-code section is missing, while cancellation and timeouts continue to
  propagate as errors. Installation documentation now states that the retrieval
  tools require `uv` and that everything else runs on Node.js alone.
- 66d2195: Move the MCP client and server SDKs from `2.0.0-beta.5` to the stable `2.0.0`
  release, so published builds no longer depend on a prerelease. Both protocol
  eras stay served: `server/discover` answers modern `2026-07-28` clients with the
  server's supported versions and instructions, and the legacy `initialize`
  handshake continues to work for older clients.
- Updated dependencies [b86e04c]
- Updated dependencies [3213a38]
- Updated dependencies [31f4b09]
  - @type-atlas/core@0.2.0
  - @type-atlas/language-server@0.2.0

## 0.1.1

### Patch Changes

- b37d065: Clarify automatic updates and exact-version pinning in the MCP installation guide.
  - @type-atlas/core@0.1.1
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

- a226ad6: Keep workspace structure output and containment checks portable on Windows.
- Updated dependencies [243c9e5]
- Updated dependencies [23f75a1]
- Updated dependencies [23f75a1]
  - @type-atlas/core@0.1.0
  - @type-atlas/language-server@0.1.0
