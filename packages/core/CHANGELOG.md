# @type-atlas/core


## 0.5.1
<sub>2026-08-22</sub>

- *(patch)* Version bump from group with `@type-atlas/mcp` v0.5.1

## 0.5.0

### Minor Changes

- 31b72f4: Publish Atlascii under the Type Atlas npm scope and update the suite to consume the scoped package.

### Patch Changes

- Updated dependencies [31b72f4]
  - @type-atlas/atlascii@0.5.0
  - @type-atlas/language-server@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [97a21a3]
  - atlascii@0.4.1
  - @type-atlas/language-server@0.4.1

## 0.4.0

### Minor Changes

- 9586792: Join a workspace already open at an outer root instead of starting a second server.

  Volar finds the configuration owning a file by walking up from the file, so a
  server started at a monorepo already answers for every package inside it. Naming
  the monorepo and then a package in it — the ordinary way an agent works — started
  a second language server and rebuilt that package's program, and with it every
  declaration file behind it, since `volar-service-typescript` keys its document
  registry on the root as well. On this repository's engine package that was a
  second copy of a 1,768-file program.

  A nested root now shares the open connection while keeping its own root: paths
  resolve here, files outside it are still refused, and the changed-file view is
  narrowed to this subtree and reported relative to it. Handing back the outer
  workspace itself does not work — it resolves a relative path against the outer
  root — which is why this is a view rather than a reuse.

  Measured: a symbol inspection through the nested root answered in 569ms against
  4,923ms for the same inspection that had to build the program.

  Two fixes to the request deadline that shipped with it. `Promise.race` abandons
  the loser without stopping it, so every answered request armed a timer that ended
  the server a minute later; the timer is now cleared when the request settles.
  And releasing a nested root now ends the server that answers for it, rather than
  dropping a view whose own disposal is deliberately inert.

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

- 9a9a1a1: Bound a language server that has stopped answering.

  A semantic request cannot be cancelled. The token Volar hands TypeScript raises
  nothing, so a request abandoned at five seconds runs to completion at nearly ten,
  and while it runs the server holds its only thread and stops reading its socket.
  Every later call for that workspace waits behind it — a folded five-line read
  needing no type checking has timed out at thirty seconds that way. Ending the
  process is the only bound a client has.

  A request that runs past sixty seconds now ends its server and says so. Sixty is
  longer than the slowest legitimate answer measured here, a cold whole-project
  check of a three-thousand-file program, so a slow project is not mistaken for a
  stuck one. The cost is one project rebuild on the next call, against a queue
  bounded only by however long the abandoned work runs.

  This fires on the deadline rather than on a caller giving up, because a caller
  giving up says nothing about whether the server is stuck, and a cheap request
  someone cancelled is not worth a rebuild. The pool already replaces a workspace
  whose process exits, so the next call starts a fresh one.

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

- 376ac46: `impact` says "at least N uses" whenever retrieval named packages the count could not confirm, and its table finally names its columns (package · uses · files · tests). `compose`'s subject ask binds `at` as finished `line:column` text — the raw protocol object rendered as nothing, leaving a dangling colon in dossier headings — and atlascii's `position()` document function passes already-formatted text through, so both spellings agree. `list_module_exports` signatures drop the probe's internal `__module.` qualifier — `(left: Money, right: Money) => Money`, the names a consumer actually writes. `quorl` positions in a file-grouped branch stand alone (`negate · 39:14`), no longer wearing a colon whose path the row above already said. `inspect_symbol`'s partial mentions section now hands the reader its next move ("references lists all 38, with paging"), and the implementation-walk caveat no longer renders under a type alias, where it read as a promise of hidden implementors. Two answers stop overstating. `find_successor`: a name whose only declarations sit in test files now answers "Declared only in tests — residue, not a capability" instead of "this name resolves", each declaration row marks its test location, and "Files discussing it" lists each file once instead of once per matching chunk. `document_symbols`: an object literal's insides are data, not declarations — a literal-valued symbol keeps its row and prices what it holds (`bankProfiles [variable] … · 33 entries`) instead of dumping every nested property, while function bodies and type members stay declaration trees and `raw` remains the complete hierarchy. And `verify_edit` no longer poisons the session it runs in: diagnosing a proposal used to leave the server answering the closed proposal's content for that file for the rest of the session (Volar caches the opened text under the file's disk mtime, which a read-only tool never moves), so navigation after a verify answered stale positions — the document now opens with disk text and carries the proposal as an ordinary versioned edit, changed back before closing, and the answers that follow describe the file that exists. Two more session-order defects fall, both caught by the new shuffled-replay determinism gate: reference answers no longer list probe documents (TypeScript retains closed probes in its program, and one rendered into a `file_references` answer as a phantom file no reader can open), and rename patches list their files in path order instead of the server's internal registry order, so the same rename renders the same patch in every session.
- 8742874: Stop reporting a declaration as its own implementation.

  The implementation request returns the declaration itself for anything that is
  not overridden, which is most TypeScript. `implementations` printed that as
  "Implementations (1)" pointing back at the position asked about — the opposite of
  what it means. It now reports none, and says the declaration is not overridden.

  Definitions are unchanged: there, returning the declaration is the answer.

- 39e89dc: Recycle an idle workspace after 45 seconds rather than 30 minutes.

  The 30 minute timeout was introduced to remove a delay that turned out to have
  other causes, and at that length it stops being a cache and retains the language
  server for a whole session. Its heap only grows: one observed session reached
  1.8 GB after 75 minutes, and exhausting it kills the workspace along with every
  request in flight, which costs the call, reports only that the connection was
  disposed, and pays the reload anyway.

  Reloading costs about 5.5 seconds on a mid-sized monorepo against 5 milliseconds
  warm, paid once per idle gap and amortized over the calls that follow. A
  predictable few seconds is the better trade against an unpredictable crash.

  This bounds idle processes only. A workspace called steadily never idles out, so
  heap growth during active work is not addressed here.

  A language server that exits mid-request now says so. Its exit disposes the
  connection, and the rejection every pending request then saw described the
  transport rather than what happened, which reads as a transient fault and
  invites an identical retry. The error now names the exit, that the server starts
  again on the next call, and that a request which keeps ending this way is too
  large to answer at once.

- 99c7836: Answer "nothing changed" without checking the project.

  `diagnostics` defaults to the files written since the workspace opened. With none
  written, the empty file list fell through to every loaded project, and the filter
  that narrows a report to the changed files cannot narrow an empty list — so the
  whole project came back under a heading that said "changed files". On a
  1,768-file project that was 28.6 seconds to answer a question whose answer was
  already known.

  It now says so in 6ms, and names the two ways to ask for the check anyway.

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

- aece154: Start a file's project when the file is first read.

  Reading deliberately never reaches the language server — the text comes from
  disk and the folding ranges from a parser over that text — so nothing builds the
  project until the first question that needs types, and that question waits for
  the whole program. A session opens by reading, so the build could have been
  running the entire time.

  Reading now asks which project owns the file and throws the answer away. That is
  the cheapest request that makes Volar resolve and build the project, so the build
  runs alongside the reads that follow. Reads are unaffected: they are answered
  from disk before the request is sent, and measured at 13ms and 28ms with it in
  place.

  The size of the saving is not established. The before-figure this would be
  compared against was taken while five language servers held programs for the same
  monorepo, so it is not a baseline worth quoting, and the after-figure varies with
  what the compiler still has to do for the files in question. Starting the build
  earlier cannot make the later question slower, and it costs the read nothing;
  that is the whole claim.

- Updated dependencies [b3d1e2b]
- Updated dependencies [eef8403]
- Updated dependencies [71f7414]
- Updated dependencies [376ac46]
- Updated dependencies [1b8a243]
  - atlascii@0.4.0
  - @type-atlas/language-server@0.4.0

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
