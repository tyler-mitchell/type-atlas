# @type-atlas/mcp

## 0.3.0

### Minor Changes

- 93092f4: Publish every tool as a canonical MCP object schema, so agents can see the
  arguments each tool takes.

  `inspect_symbol` and `explore_symbol` selected their target with a schema union
  — either `{file, position}` or `{file, symbol}`. MCP publishes a tool's input as
  an object schema, and a union has no properties to publish, so both tools were
  advertised as taking no arguments at all. Clients sent none, and every call
  failed reporting that `file` was missing. Both now take one object with
  `position` and `symbol` optional, and require exactly one of them in the
  handler, where the error names what was actually wrong.

  Parameters that accept several values were published without a type, so clients
  serialized arrays into strings. `read_file` now takes `file` as an array,
  `search_dependency_code` takes `package` as an array, `list_files` takes `glob`
  as an array, and `selection_ranges` takes `position` as an array. A `read_file`
  entry is a path, or a `{ path, startLine, endLine, fold }` view bounding that one
  file, and the top-level `startLine`, `endLine`, and `fold` apply to entries that
  set none of their own.

  `includeDiagnostics` was `boolean | 'verbose'`, which published no type. It is
  now `'summary' | 'verbose' | 'off'`, defaulting to `summary`; `off` replaces
  `false` and `summary` replaces `true`.

  Enumerated parameters — `scope`, `view`, `surface`, and `only` — published
  nothing at all, because attaching metadata to a union distributes it across the
  branches and loses the enum. They now publish their allowed values. Defaults
  that could not be serialized, including the `path` default that reached agents
  as the literal string `"$ark.default"`, are gone or expressed as scalars, and
  defaults declared through `.describe().default()` are now published rather than
  silently dropped.

  Every published parameter now carries a description, and undeclared keys are
  ignored rather than failing the call.

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

- Updated dependencies [4314ad0]
- Updated dependencies [37d55e3]
- Updated dependencies [0a8369e]
  - @type-atlas/core@0.3.0
  - @type-atlas/language-server@0.3.0

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
