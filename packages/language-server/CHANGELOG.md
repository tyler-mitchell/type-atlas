# @type-atlas/language-server

## 0.4.1

## 0.4.0

### Patch Changes

- eef8403: A language-server death mid-request could surface as a bare "Connection is disposed": the synthetic document's close notification threw from its cleanup and replaced the informative exit report. Crashes now surface with their cause and the server's last words, and unexpected tool errors log their stack to stderr. The `typescript-auto-import-cache` integration is disabled via `volar-service-typescript`'s own option — its project initialization was one trigger of a bridge defect that kills program rebuilds after an unowned document enters the host. `add_missing_imports` says honestly when names do not resolve and the engine proposed no fix, instead of "No missing imports." `document_links` actually lists its links (a renderer key mismatch dropped every row under the count) and shows out-of-workspace targets relative to the document, never as machine-absolute paths. `project_config` answers workspace-relative like every other tool, and `inlay_hints` renders in reading order.
- 71f7414: Keep configured language-service plugins in a project diagnostic scan.

  A project check asked the program for every file's diagnostics at once. That
  reads as the cheap way to do it, and it silently dropped every diagnostic a
  project's configured TypeScript language-service plugin contributes: the Effect
  adapter this repository ships routes through the decorated language service only
  when `getSemanticDiagnostics` is called _with_ a source file, and falls back to
  the raw program when called with none. A project configuring
  `@effect/language-service` therefore saw its own diagnostics in `tsc` and not
  here.

  The scan now runs file by file over the same program, which is how the plugin
  contract is entered, and the comment on it records what it is: a knowing
  deviation from the evidence ledger's prescription of Volar's own per-file
  `getDiagnostics`, taken because that path re-enters the semantic provider for
  every document with no short-circuit, and bounded by this server registering no
  virtual-code language plugin.

- 376ac46: `impact` says "at least N uses" whenever retrieval named packages the count could not confirm, and its table finally names its columns (package · uses · files · tests). `compose`'s subject ask binds `at` as finished `line:column` text — the raw protocol object rendered as nothing, leaving a dangling colon in dossier headings — and atlascii's `position()` document function passes already-formatted text through, so both spellings agree. `list_module_exports` signatures drop the probe's internal `__module.` qualifier — `(left: Money, right: Money) => Money`, the names a consumer actually writes. `quorl` positions in a file-grouped branch stand alone (`negate · 39:14`), no longer wearing a colon whose path the row above already said. `inspect_symbol`'s partial mentions section now hands the reader its next move ("references lists all 38, with paging"), and the implementation-walk caveat no longer renders under a type alias, where it read as a promise of hidden implementors. Two answers stop overstating. `find_successor`: a name whose only declarations sit in test files now answers "Declared only in tests — residue, not a capability" instead of "this name resolves", each declaration row marks its test location, and "Files discussing it" lists each file once instead of once per matching chunk. `document_symbols`: an object literal's insides are data, not declarations — a literal-valued symbol keeps its row and prices what it holds (`bankProfiles [variable] … · 33 entries`) instead of dumping every nested property, while function bodies and type members stay declaration trees and `raw` remains the complete hierarchy. And `verify_edit` no longer poisons the session it runs in: diagnosing a proposal used to leave the server answering the closed proposal's content for that file for the rest of the session (Volar caches the opened text under the file's disk mtime, which a read-only tool never moves), so navigation after a verify answered stale positions — the document now opens with disk text and carries the proposal as an ordinary versioned edit, changed back before closing, and the answers that follow describe the file that exists. Two more session-order defects fall, both caught by the new shuffled-replay determinism gate: reference answers no longer list probe documents (TypeScript retains closed probes in its program, and one rendered into a `file_references` answer as a phantom file no reader can open), and rename patches list their files in path order instead of the server's internal registry order, so the same rename renders the same patch in every session.
- 1b8a243: Answer references from the project that owns the file, as Volar does.

  An earlier change queried every loaded project so a symbol's usages in sibling
  packages would appear. It worked, and it made the hottest tool unusable:
  `inspect_symbol` asks the same request, so once a second project loaded, an
  identical repeated call went from 21ms to 3830ms — 180 times slower — and grew
  with every further project a session touched.

  Cross-package usages are worth having, but not at that price on every symbol
  lookup. References are project-scoped again, and each result says so.

## 0.3.0

## 0.2.0

### Minor Changes

- 3213a38: This release is breaking. Honor project-configured TypeScript language-service plugins, including the Effect language service, and make the diagnostics tool inspect the selected TypeScript project by default. Project diagnostics reuse the selected Volar project, remain silent when clean, page agent-facing output, refresh automatically after filesystem changes, and preserve cancellation and timeout behavior. Normal file tools continue to surface one complete ambient error or warning without promoting a redundant file-diagnostics call. Native LSP resolution and concurrent dependency operations no longer depend on process-wide request queues. Agent-facing source coordinates are now consistently one-based, and `list_files` accepts either one glob pattern or an array.

## 0.1.1

## 0.1.0

### Minor Changes

- 243c9e5: Establish the Type Atlas package suite and its production release toolchain.
- 23f75a1: Publish the suite under the `@type-atlas` scope with a cross-platform
  `type-atlas` executable, one-command client installation, verified package
  contents, and official MCP Registry discovery.
- 23f75a1: Add bounded, Windows-safe workspace structure navigation and harden
  code-intelligence, dependency-discovery, editing, freshness, and agent-facing
  output behavior for production repository use.
