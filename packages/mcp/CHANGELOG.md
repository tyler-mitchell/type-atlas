# @type-atlas/mcp

## 0.4.1

### Patch Changes

- 82bdf8c: A retrieval hit is labelled by the declaration its snippet shows. The anchor was
  chosen against the chunk retrieval matched, but the snippet re-centres on the
  query's own identifier, so the two windows differ — `AccountStore` titled six
  lines that showed `parentPath`, and the position an agent would carry into its
  next call pointed at a declaration absent from the code beside it. A match now
  carries both anchors, because they answer different questions: the matched
  declaration still drives relationship expansion, and only the label follows the
  printed window. Collapsing them into one was the first attempt and it cost
  `investigate_code` its verified-relationships section.

  Choosing that label needed both halves of the obvious rule. Raw overlap named a
  class for six lines of one method, the method's doc comment belonging to the
  class and giving it one extra line; pure containment fixed that and named a
  one-line property for a six-line config object, because anything small and
  wholly inside the window scores perfectly. The score squares the overlap before
  dividing by the declaration's own length, so a label must both fill the window
  and not sprawl past it.

  `inspect_symbol` no longer reports implementations for a type alias. Nothing
  implements one — `implements` cannot name an alias — so every entry the walk
  returned was a variable annotated with it, and which entries it returned was not
  even stable: a packed build on Linux listed a `readonly Money[]` constant under
  `Money` where the same question answered nothing on macOS.

- Updated dependencies [97a21a3]
  - atlascii@0.4.1
  - @type-atlas/core@0.4.1
  - @type-atlas/language-server@0.4.1

## 0.4.0

### Minor Changes

- 376ac46: `impact` says "at least N uses" whenever retrieval named packages the count could not confirm, and its table finally names its columns (package · uses · files · tests). `compose`'s subject ask binds `at` as finished `line:column` text — the raw protocol object rendered as nothing, leaving a dangling colon in dossier headings — and atlascii's `position()` document function passes already-formatted text through, so both spellings agree. `list_module_exports` signatures drop the probe's internal `__module.` qualifier — `(left: Money, right: Money) => Money`, the names a consumer actually writes. `quorl` positions in a file-grouped branch stand alone (`negate · 39:14`), no longer wearing a colon whose path the row above already said. `inspect_symbol`'s partial mentions section now hands the reader its next move ("references lists all 38, with paging"), and the implementation-walk caveat no longer renders under a type alias, where it read as a promise of hidden implementors. Two answers stop overstating. `find_successor`: a name whose only declarations sit in test files now answers "Declared only in tests — residue, not a capability" instead of "this name resolves", each declaration row marks its test location, and "Files discussing it" lists each file once instead of once per matching chunk. `document_symbols`: an object literal's insides are data, not declarations — a literal-valued symbol keeps its row and prices what it holds (`bankProfiles [variable] … · 33 entries`) instead of dumping every nested property, while function bodies and type members stay declaration trees and `raw` remains the complete hierarchy. And `verify_edit` no longer poisons the session it runs in: diagnosing a proposal used to leave the server answering the closed proposal's content for that file for the rest of the session (Volar caches the opened text under the file's disk mtime, which a read-only tool never moves), so navigation after a verify answered stale positions — the document now opens with disk text and carries the proposal as an ordinary versioned edit, changed back before closing, and the answers that follow describe the file that exists. Two more session-order defects fall, both caught by the new shuffled-replay determinism gate: reference answers no longer list probe documents (TypeScript retains closed probes in its program, and one rendered into a `file_references` answer as a phantom file no reader can open), and rename patches list their files in path order instead of the server's internal registry order, so the same rename renders the same patch in every session.
- c2cfbe9: Read-only tools accept an `intent` — one sentence naming the implementation decision a call serves — and echo it above the answer, so a session's transcript carries its own strategy chain. Started with `--require-intent`, a call that states none is refused with the question it failed to answer; without the flag the field is optional and nothing changes. The flag exists because agents sprawl: long navigation runs whose reading is out of all proportion to the change being made, and which afterwards cannot say why. A client turns it on where it names the command, so it binds exactly the sessions it is set for.

  `investigate_code` also stops decorating a weak retrieval with verified-looking relationships. Relationship expansion now requires the question and the candidate to share an identifier, so a question the index cannot answer says so — "none of these declares anything the question names" — and names the two moves that would answer it, instead of rendering a confident block over the nearest neighbour.

- 2e6c824: `list_files` fuses `git status` into the tree with the editor-standard badge letters and change sizes: files carry their state (`· M +2 -1`, `· A +8`, `· U`, `· C`), a rename names its origin (`· R dedupe.ts →`), deleted files appear as ghost rows (`· D -12`), and a directory holding changes anywhere beneath it says how many (`· 3 changed`) — so one orientation call also answers "what differs from HEAD, where, and by how much". Default on (`git: false` to disable), silent outside a repository. `changed: true` lists only the working-tree delta as one tree, at any depth — the two changed files in a large monorepo without the hundreds of clean rows around them, and a clean tree says so. Bounds now show what they cut instead of folding it away: a directory the limit touched keeps its shown children and closes with `… N more`, each `expand` subtree accepts its own `limit`, a glob listing's folded counts answer under the same glob, and the bound trailer paragraph is gone. `callees` now folds standard-library calls to one line of distinct names — the project's own calls lead, and the answer no longer varies with the directory the compiler is installed under.
- eed6a3a: `list_files` prices each rendered file with its line count — `money.ts · 52 loc`, `pnpm-lock.yaml · 3.9k loc` — so a listing doubles as a reading-cost map; `loc: false` turns it off. Diagnostics no longer leak machine-absolute paths inside TypeScript message text (`import("packages/money/src/money").Money`, workspace-relative like every other path), and when several problems share a line each code frame now carets its own span instead of the last one's.
- aece154: Answer syntactic questions without loading a TypeScript program, and report what
  a call cost.

  `read_file` asked the language server for folding ranges. Volar resolves a
  request to the project owning the document before dispatching it, so folding a
  file loaded that project's entire program — 4,782 ms for the first read of a
  3,545-file project, against 22 ms for the same read with `fold: false`. Nothing
  about folding needs a program: `volar-service-typescript` answers
  `textDocument/foldingRange` by handing the document to a syntax-only TypeScript
  service and converting its outlining spans.

  That is now what runs, in this process, on text already read from disk —
  `getLanguageServiceByDocument` and `convertOutliningSpan` from that same
  package, so a folded view is byte-identical to what the server returned. The
  same read is 8 ms. A read no longer touches the language server at all, and
  costs what reading a file costs regardless of which project the file belongs to
  or whether that project has ever been loaded.

  Semantic search had the same problem, one result at a time. Labelling a match
  with the symbol containing it asked the language server for that file's document
  outline, and search answers from the whole search root, so a page of results
  spanning four packages built four programs to label itself. Document symbols are
  syntactic too — the same plugin provides them, from `getNavigationTree` over the
  same syntax-only service — so `search_code`, `related_code`, and
  `explore_symbol` now label their results from a parse. A five-result page
  spanning three packages, none of them loaded, is 1.2 s and loads nothing, and
  what remains in it is semble's own work in its own process.

  `inspect_symbol` asked the same question three ways. Resolving a name wanted the
  document's outline, finding what a position sits inside wanted it again, and
  naming a definition wanted the outline of whichever file it landed in — three
  requests, each of which could build a program, and the first of them ran before
  anything else so a name target waited on a project just to find out which
  declaration it meant. All three are parses now. What remains of the identity
  question is two cases rather than five: a callable carries its own name and kind
  from the call hierarchy, and anything else is the declaration its definition
  points at, or the one it sits inside.

  Finding that enclosing declaration also stopped flattening the outline, sorting
  every declaration in the file by how tightly it wraps the position, and taking
  the first. An outline is a tree, so it is one descent through the branch that
  contains the position. `flattenSymbols` lost its `SymbolInformation` half, which
  nothing can reach now that outlines are parsed here.

  Three more things go with it. `serving()` leaves `VolarWorkspace`: it existed to keep
  reads off a cold server, and answered the wrong question — it reported that
  _some_ request had been answered, while the cost is the program for _this file's_
  project, so the first read in each new project paid it anyway. `readSource`
  leaves `createTypeAtlas`, having had no callers since `read_file` was rewritten
  around `readSourceView`. And the "language server was still starting" notice
  leaves `read_file`, along with the `folded` flag that drove it, because folding
  is no longer something a read can fail to get.

  Every tool now reports its own elapsed time on the last line of its answer. A
  cold project load and a warm lookup return the same text, and an agent choosing
  what to ask next — whether to narrow a search, whether a package is already
  loaded, whether a repeat is free — is choosing on exactly that difference.

- aece154: Stop giving every searched directory an index of its own.

  `search_code` and `related_code` handed `directory` to semble as the repository
  to index. Semble keys its cache on a hash of the resolved path, so a directory
  and the workspace containing it never share an index: naming the directory built
  a second one from scratch. On a real example — a traffic-policy directory inside
  `webgpu-engine` — that was thirteen seconds, paid for a narrowing that was asked
  for to make the search cheaper, and paid again for every other directory an agent
  scoped to.

  The workspace is the index now, and the directory selects from its results.
  Semble's search takes no path filter, so a scoped page is filled by asking the
  workspace index for a wider one and keeping what falls under the directory; a
  warm search costs tens of milliseconds, so asking twice is far cheaper than
  building a second index. If the workspace index genuinely does not hold enough
  under that directory, the directory is indexed after all — the answer is never
  worse than before, only faster in the common case. Result paths are reported
  against the search root either way, so a scoped page reads the same however it
  was obtained.

  A directory-scoped search that had never been indexed went from thirteen seconds
  to 263ms.

- aece154: Add `watch_diagnostics`, a bounded subscription to one file's diagnostics.

  An agent otherwise learns that its edit broke something only by asking, and an
  agent mid-edit rarely thinks to ask. This registers a resource for the file and
  invalidates it whenever the diagnostics change, so a client holding a
  subscription is told without the agent spending a call.

  The trigger is any change in the workspace rather than a change to the watched
  file, because a file's diagnostics most often change when a _different_ file is
  edited — the case a file-bound watcher stays silent through, and the one an agent
  most needs to hear about. Each settled change re-reads the file through the
  language server, so what is published is the language server's own answer.
  Repeated writes that settle to the same result stay silent, and a burst collapses
  into one report.

  Delivery is the client's half. `sendResourceUpdated` reaches a 2026-07-28
  `subscriptions/listen` stream and a 2025 client alike, and the client reads the
  resource back for the report, because the protocol's change event carries a URI
  and no content. A client that ignores resource updates receives nothing beyond
  the tool's own reply, and both the reply and the server instructions say so
  rather than implying a delivery that will not happen.

  `@type-atlas/core` gains `observeChanges` on a workspace, which reports every
  file change to a caller. The workspace already watches its root to keep the
  language server's file view current, so this reuses that watcher instead of
  having callers start one of their own.

### Patch Changes

- eef8403: A language-server death mid-request could surface as a bare "Connection is disposed": the synthetic document's close notification threw from its cleanup and replaced the informative exit report. Crashes now surface with their cause and the server's last words, and unexpected tool errors log their stack to stderr. The `typescript-auto-import-cache` integration is disabled via `volar-service-typescript`'s own option — its project initialization was one trigger of a bridge defect that kills program rebuilds after an unowned document enters the host. `add_missing_imports` says honestly when names do not resolve and the engine proposed no fix, instead of "No missing imports." `document_links` actually lists its links (a renderer key mismatch dropped every row under the count) and shows out-of-workspace targets relative to the document, never as machine-absolute paths. `project_config` answers workspace-relative like every other tool, and `inlay_hints` renders in reading order.
- aece154: Start semble when this server starts, not on the first search.

  Semble runs as its own process, and starting it is `uvx` resolving the package,
  Python booting, and an MCP handshake — most of two seconds. The client connected
  on first use, so the first search of a session wore all of it: 2,365ms for a
  query that costs 349ms once the process is up.

  The connection is opened when the server is created and awaited where it was
  before, so it happens while the agent is reading files and a search arriving
  later joins a connection already open. A failure is still reported at the search,
  with the message that says how to install uvx. The first search of a server's
  life is now 959ms.

- 5704120: Join a semantic index already built over a containing root.

  Semble keys its cache on the resolved path it is handed, so a package and the
  monorepo containing it never share an index. Fixing `directory` earlier stopped a
  second index per scope, but the workspace root had the same problem one level up:
  naming the monorepo and then a package inside it built two indexes over
  overlapping files — 13 seconds for the second, measured.

  A search now uses a root already indexed in this session that contains the
  requested one, and otherwise the requested one, so a session that only ever names
  the package still indexes the package rather than everything above it. Results
  are re-based from whichever root was indexed, so a scoped page reads the same
  either way.

  Measured: the package-scoped search after a monorepo-scoped one answered in 52ms.

- 8742874: Stop reporting a declaration as its own implementation.

  The implementation request returns the declaration itself for anything that is
  not overridden, which is most TypeScript. `implementations` printed that as
  "Implementations (1)" pointing back at the position asked about — the opposite of
  what it means. It now reports none, and says the declaration is not overridden.

  Definitions are unchanged: there, returning the declaration is the answer.

- 7cfd0ea: `occurrences` scans and reports files in lexicographic order instead of filesystem crawl order, so identical runs produce identical answers and results can be compared across changes.
- 1bce7c3: Say each thing once in the tool surface.

  Tool descriptions and schemas are serialized into every model request, so text
  repeated between the server instructions and a tool's own description is paid for
  on every call an agent makes, whichever tool it calls. The `diagnostics`
  description and its `scope` field restated the changed-versus-project semantics
  the server instructions already give; both are now the short form.

  The `directory` description was also stale as well as long. It told agents that
  each distinct directory has its own Semble index and that scoping therefore
  answers faster — true before the workspace became the index, and misleading now
  that scoping costs nothing. It says what it does instead.

- aece154: Ask the language server less to answer the same questions.

  `inspect_symbol` asked a document for its outline up to three times. A name
  target needed it to resolve the name; a position target then asked again to find
  the declaration a position falls in, and again to match a definition to its
  outline entry. The outline is now requested once — a position target's request
  joins the wave it already waits on, so it costs no extra round trip — and the two
  follow-up questions are answered from it. Only a definition in a _different_ file
  still reaches across, which is the one case the answer is not already in hand.

  `references` no longer asks for hover. The `Query:` line it produced could never
  work: it took the first line of the hover's markdown, which for a TypeScript
  symbol is the opening code fence, so the line rendered as ` ```typescript `
  in every answer it has ever given. Both the line and its round trip are gone;
  `Scope:` already names the anchoring project, and the caller supplied the
  position.

  `type_definitions`, `implementations`, `callers`, `callees`, and
  `document_highlights` now go through `@type-atlas/core` rather than sending
  protocol requests from the tool body. The two call-hierarchy tools each carried
  their own prepare-then-fan-out; that shape is declared once in core and the tools
  became assembly, which is what every other tool here already is.

  `showTypeDefinitions` leaves `InspectSymbolResult`. Type definitions are only
  fetched when the caller asks for them, so the flag could never reveal anything
  the section did not already have.

- Updated dependencies [b3d1e2b]
- Updated dependencies [eef8403]
- Updated dependencies [9586792]
- Updated dependencies [71f7414]
- Updated dependencies [376ac46]
- Updated dependencies [8742874]
- Updated dependencies [39e89dc]
- Updated dependencies [99c7836]
- Updated dependencies [aece154]
- Updated dependencies [aece154]
- Updated dependencies [9a9a1a1]
- Updated dependencies [1b8a243]
- Updated dependencies [aece154]
- Updated dependencies [aece154]
  - atlascii@0.4.0
  - @type-atlas/language-server@0.4.0
  - @type-atlas/core@0.4.0

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
