# Issues

Things the MCP surface does that it should not, or does not that it should,
found by using it. Written at the moment of discovery, because a finding
deferred to the end of a session is a finding lost.

Every entry states **how it was observed**, because a finding without a
reproduction is a rumour, and the next reader needs to confirm it still holds
before acting on it.

An entry leaves this file when it is fixed, not when it is explained.

**〈raised〉** marks an issue the maintainer raised rather than one found while working,
whether or not the message said `issue:` — anything they point out that reads as
a defect belongs here, and waiting for the prefix loses the ones he mentions in
passing.
Those are deferred on arrival — captured here and left alone — unless they
happen to land on whatever is already open at that moment. The mark exists so
the distinction survives the session that recorded it.

One raised message often carries more than one issue. They are split here
rather than filed as one, because they are fixed separately and one of them
being done should not make the other look done with it.

---

## Next

What is being worked on and in what order, for the objective in hand. Kept at
the top because a list of defects with no stated intent is a list nobody acts
on, and this is the part that goes stale first — if it disagrees with the work,
the work is right and this needs rewriting.

Presentation consistency and configurable path rendering are done. Release
readiness is the objective now, and development passed to Fable 5 at `c5b946a`.
Both release blockers are fixed and verified (2026-08-19). The probe-document
leak: `list_module_exports`, then whole-project `diagnostics` on
`packages/mcp` — 205 files, no problems. And `workspace_symbols` answering
empty: the tsgo bridge's program enumerates shell source files — no
statements, empty name tables — that TypeScript's whole-program navigate-to
walks to nothing, so `workspace-declarations.ts` now asks navigate-to per
file, whose single-file form acquires the parsed file through the
materializing accessor and keeps TypeScript's matcher, kinds, and containers
authoritative; the broken whole-program form is held by an expected-fail
sentinel in `packages/language-server/test/navigate-to.test.ts` that reports
when the platform starts answering. The same pass gave the answer its missing
page line and its positions.

1. **Finish the silent-window sweep.** Fixed and verified: `workspace_symbols`,
   `references`, `file_references` (pager total in the preamble, `page.mdoc`
   continuation), and `read_file` (answer-shared budget, derived windows).
   Verified already honest: `completions`, `callers`, `callees`, `list_files`.
   Unchecked: `quorl`, `explore_symbol`, `investigate_code`,
   `search_dependency_code` at volume; `diagnostics` belongs to its raised
   rework below.
2. **Pressure-test the surface** against a real monorepo before release;
   defects land here as they are found.
3. **Ground `kindAt` in `SymbolKind`.** Language-neutral, and required before a
   second language is worth attempting — not before release.
4. **Retire the terminal-control exports**, or find the consumer that justifies
   them. Nothing here calls them and they are not code intelligence.

Done under the previous objective, for context on what the entries below
survived: one nesting mechanism replacing three, one location shape with one
rule for when a file becomes a level, the banner, `displayPath` with three
working styles on `pathe`, presentation settings reaching the server from its
environment and proven across the process boundary, the document lint, and a
page line that states a range and names the parameter that continues it.

A rendered-output "hole" check was also built and then removed. It scanned
answers for the punctuation a missing value leaves behind, and broke `read_file`
three times on content that legitimately contained it. The reasoning is kept at
`packages/core/src/markdoc/render.ts` so it is not attempted again unchanged.

---

## Correctness

### 〈raised〉 Diagnostics needs scrutiny and rework in general

Raised as a standing concern; this session's observations of one file
(`packages/mcp/src/document.tools.ts`, 2026-08-19) already show three surfaces
telling three stories: the ambient line on `document_symbols` said "1 problem
at this position" for a request that has no position, counting a ts(6133)
hint as a problem; `diagnostics` with default scope answered "No diagnostics ·
Changed files · 74 files checked" anchored at `packages/core/tsconfig.json`
for a `packages/mcp` file, without saying whether the named file was among
the 74; `diagnostics scope: "project"` said "No diagnostics · 203 files"
while the hint stood. A references answer also appended "6 problems in
<file> · reused, first cost 107ms" — hints as "problems" again, plus an
unexplained "reused" clause. Severity vocabulary, scope naming, and what the
ambient line may claim all need one coherent design.

〈raised〉 And the rows have no referent. `hint ts(6385) 419:55-419:65 ·
'deprecated' is deprecated` names a place and never what stands there —
deprecated _what_, inside _which_ declaration — breaking the surface's own
location grammar (`name [kind] · path:pos`), which every reference row already
pays for through the declaration chain (`within`). A reader must open the file
to understand any row. The enrichment affordance exists and is in use one tool
over; diagnostics rendering never adopted it. Applies to the ambient block and
the diagnostics tool alike. Observed 2026-08-19, and consumed twice in passing
before being caught — by the maintainer, not by the session.

### An absence branch asserts a conclusion the tool cannot know

While the symbol index was broken (2026-08-19, since fixed),
`workspace_symbols` still explained its empty answer: _"this is absent from what has been opened, not from the repository"_.
The project is loaded and `document_symbols` lists the name, so the sentence is
false — the honest statement was that the search answered nothing, and the
copy went further because it was written assuming the mechanism beneath it
works.

Absence copy is where the observation/conclusion rule binds hardest: an agent
acts on an absence claim with no result to cross-check it against. A branch may
name which nothing it is only when the tool can actually tell; otherwise the
explanation is the part that misinforms. Observed 2026-08-19 —
`workspace_symbols` for `indentGuide`, 32ms, empty, project demonstrably
loaded.

### The surface cannot prove a literal token absent

Verifying a real architectural audit against kek (2026-08-19) required
"`device.lost` is never handled" — a literal-occurrence question. Every
search this surface has is semantic (semble ranks by meaning and cannot say
no — its best match for `device.lost` was a comment about "lost substance"
at relevance 100%) or symbolic (workspace_symbols needs a declaration;
references needs a position). There is no tool answering "where does this
exact text occur under this directory", and teardown work — the audit's
delete items, alias checks, string keys, config references — lives on
exactly that proof. Absence today is argued from ranked non-answers, which
the confidence-for-nothing entry above shows is unreadable. A literal
occurrence check with an honest zero ("nothing under src/ contains this
token, N files scanned") is a missing capability, not a presentation gap.
Observed 2026-08-19 while verifying the webgpu-engine P0 audit's device-loss
claim through three approximating calls.

### `search_code` reports full confidence for a query that matched nothing

Relevance is relative to the strongest match, so the best of a bad set always
reads as 100%. A query of pure nonsense returns results at 100% and 92%:

```
search_code { query: "zzqx nonexistent phrase that should match nothing at all" }
→ 2 matches · relevance is relative to the strongest match
  === 1 · src/document/tags.ts:327-344 · relevance 100% ===
```

Nothing in the answer separates "this is what you asked for" from "this is the
least unlike it", and the honest answer — nothing matched — is one the tool
cannot produce. The absence branch added to `search.tool.mdoc` is reachable only
when the index is empty.

Both this and `find_successor` above break the same rule: **a tool may report
what it observed, and may not report what that observation implies about the
world.** Ranking is an observation; "this is relevant" is a conclusion.

### 〈raised〉 Plumbing on the consumer side is a framework deficit

Standing lens, not a single defect: wherever `packages/mcp` fits, adapts, or
transforms on its way into `atlascii`, treat it as evidence that the framework
lacks an affordance — and ask each time whether the fault is the consumer using
it wrongly, the framework missing the affordance, or both. Presentation still
living in the MCP is the loudest form.

Confirmed instances, each the same shape — the consumer decided something the
document is supposed to own, because the document offered no way to say it:

- A nested ternary chose between two English phrases for a missing project
  (`"an inferred project"` / `"the project inferred for this file"`), in three
  handlers. Fixed: the handler passes the project or nothing, the document
  writes the sentence.
- `symbolKind(...)` is called in four handlers to turn a protocol kind number
  into a word, while the document layer exposes `symbolKind()` as a function for
  exactly that. A consumer that resolves the word first makes the message
  catalog unreachable — renaming a kind cannot reach an answer whose word was
  already chosen.
- `noun({ singular, plural })` precomputes English plurals into variables the
  documents no longer read, having moved to `{% plural %}` with CLDR forms.
  Dead plumbing whose own docstring calls the two-form API "an English
  assumption wearing an API".

The sweep is not finished; these are the ones confirmed so far.

### 〈raised〉 The `file_references` preamble needs rethinking

```
packages/mcp/src/experimental.tools.ts is referenced from 2 places, across every
project loaded this session, anchored at packages/mcp/tsconfig.json in
/Users/tylermitchell/Projects/featuretype.
```

One sentence carrying five facts — subject, count, scope, anchor, root — read
as a single run-on clause. Raised as needing rethinking; the shape it should
take is not decided here.

---

### `references` counts a row it never lists

`references` on `normalBalance` (ledger fixture) answers "4 references" and
lists three rows; on `Money`'s earlier capture, "2 references" over one row.
The declaration is inside the count and outside the listing, so the numbers
never reconcile with what is on screen. Either the count should exclude the
declaration or the declaration should be a row. Observed 2026-08-20 in the
scenario captures (`packages/mcp/test/scenarios/responses/references/`).

### One stray NUL byte refuses a whole text file

`read_file` on `~/.claude/skills/guardrails/scripts/navigation-guard.ts`
(9,317 bytes) answered "is a binary file — there is no text to read", and
`list_files` left the same file unpriced — both NUL detectors agree the file
carries at least one NUL somewhere, yet the default Read tool renders ~199
lines of ordinary TypeScript from it. When a file is overwhelmingly text, an
all-or-nothing "there is no text" is an absence lie; the honest answer reads
the text and names the anomaly ("contains a NUL at byte N"). Observed
2026-08-20.

### The bridge dies rebuilding a program after an unowned document was opened

DIAGNOSED 2026-08-20 to the frame, via the scenario suite's minimal
reproducer (kept as the sentinel):

```
pnpm exec vitest run --project=scenarios -t "fixture-readme|renamed-method-hunch|surface-filtered-by-query"
```

`document_links` on the unowned fixture README plus `find_successor`, then
any call whose probe reopens a document: the language server exits (code 1)
inside typescript-native-bridge's `createTsgoProgram` during
`synchronizeHostData` — the same frame family as the auto-import-cache
crash, which was therefore a TRIGGER of this defect, not its root. Root:
host data containing a document no tsconfig owns kills the bridge's next
program rebuild. Candidate own-layer mitigation to investigate: keep unowned
documents out of the TypeScript host entirely. Until then the corpus runs
the two trigger scenarios last, and their own captures are sound.

Found beneath it and FIXED: `withTextDocument`'s close notification threw
"Connection is disposed" from its `finally` when the server died mid-task,
replacing the informative exit report — every such crash surfaced as a bare
transport sentence. The close is now owed to a live connection only, and
unexpected tool errors log their stack to stderr (the README's operational
contract), which is what named this frame. Observed 2026-08-20.

### FIXED · the unowned-document crash was the auto-import cache

`document_links { file: "README.md" }` against `fixtures/ledger` exited the
language server (code 1), and the scenario suite captured the stack the old
unowned-document entry never had: `typescript-auto-import-cache`'s
`initProject` dying inside the bridge's `synchronizeHostDataWorker`
(typescript.js:167426). The fix: `volar-service-typescript` documents a
`disableAutoImportCache` option, now set in
`packages/language-server/src/server.ts` — on this engine the cache crashed
the server and provided no import fixes even when it survived, so disabling
cost nothing. Witnessed 2026-08-20: the exact killing call answers cleanly,
warm and repeatable; the restored `document_links/fixture-readme` capture
stands as the regression witness. One flag re-enables the cache when the
bridge matures. The absent-auto-import entry below remains open — that is
the engine's gap, not the cache's, and `add_missing_imports`' capture is its
sentinel.

### `implementations` answers empty for an interface with a same-file implementor

`implementations` at `AccountStore` (ledger fixture, account.ts:31:18) answers
the no-implementation sentence although `MemoryAccountStore implements
AccountStore` stands in the same file — warm server, file open, 68ms. Yet a
kek-monorepo observation (2026-08-19) shows the same tool answering
`Implementations (5)` warm. Whether the interface case specifically fails in
the bridge's goToImplementation, or the walk drops it, is undiagnosed; the
committed capture (`responses/implementations/store-interface.txt`) pins the
current wrong answer and will flag any change. Observed 2026-08-20.

### `signature_help` never names the active parameter

The one question at a call site is "which parameter am I on", and the answer
(`responses/signature_help/inside-a-call.txt`) renders the signature and the
parameter list without marking the active one, though LSP supplies
`activeParameter`. Observed 2026-08-20.

### `rename_files` warns about files that need no update

The move patch's honesty note lists `journal.test.ts`, `csv.ts`,
`matching.ts`, `drift.ts` as "not updated" after moving `posting.ts` — but
every one of them imports through the barrel or the package specifier and
needs no change. A warning that cries wolf sends an agent to fix four files
that need nothing. The list should contain only files whose import specifier
actually names the moved module. Observed 2026-08-20 in
`responses/rename_files/module-move-updates-importers.txt`.

### Missing-import fixes exist but depend on session history

CORRECTED 2026-08-20 (the earlier version claimed the engine offers no
import fixes — that was cold-state absence read as an engine gap). The
truth, witnessed both ways in scenario subset runs: `add_missing_imports` on
`matching.ts` produced a real 4-edit patch in a session where
`organize_imports` had run first, and produces nothing in the full suite's
order even with every project warm — availability of the fixMissingImport
family depends on what the session did before, which is itself the defect.
The one witnessed patch carried its own wart: it imported a sibling
workspace package as `../../money/src/money.ts` instead of the
`@ledger/money` specifier the package boundary calls for. The honest-empty
sentence covers the misses; the committed capture is the sentinel for
whichever behavior stabilizes. Observed 2026-08-20.

## Language grounding

### `kindAt` reads TypeScript hover text with a regular expression

`packages/mcp/src/navigation.tools.ts` matches
`const|let|var|function|class|interface` against hover prose to name a symbol's
kind. Every other kind in the surface comes from the protocol's own
`SymbolKind`, which is language-neutral. This one would answer wrongly, and
silently, for any language added later.

### One declaration, two kind words across sibling tools

`Guide` in `atlascii/src/layout/hierarchy.ts` is a `type` alias.
`document_symbols` reports it `[interface]` — TypeScript's navtree word — and
`workspace_symbols` reports it `[class]`, the mapping this surface chose
because `SymbolKind` has no alias kind. One symbol wearing two words across
sibling answers is lateral incoherence of exactly the kind the `kindAt`
grounding above should settle: one protocol word, chosen at one seam.
Observed 2026-08-19. Same split on kek-monorepo: `planTensorStorage`, a
`const` arrow function, is `[constant]` in `workspace_symbols` and
`[function]` in `inspect_symbol`.

### The outline names a member `<unknown>`

```
page [variable] 28:14-28:18 · range 28:14-36:2
├  <unknown> [property] 34:5-34:55
```

The syntactic outline of `packages/core/src/projection.ts` renders a row whose
name slot is the literal `<unknown>` — the conditional-spread member on line 34
has no name the parser will state, and the placeholder flows straight into the
location grammar (`name [kind] · pos`) as though it were one. A row that
cannot be named should say what it is (the source text, or a sentence), not
wear a bracketed token from the parser's vocabulary. Reaches `document_symbols`
and anything else rendering the outline. Observed 2026-08-19 in the `compose`
POC's pinned snapshot (`packages/mcp/test/compose.test.ts`).

### `list_module_exports` shows TypeScript's `detail` verbatim

A re-exported alias renders as two lines — `(alias) const x: T` followed by
`export x` — because `detail` carries a newline and the second line restates the
name. Faithful, and noise. Distinguishing the signature from the declaration
form means parsing hover text, which is the same grounding problem as above.

---

## Presentation

### 〈raised〉 `read_file` wants a way to drop the line-number column

Raised 2026-08-20: reading long documents for read-only purposes — no edit
intent — the line-number gutter spends tokens on numbers nothing will use.
An optional argument should let a reader ask for the bare text. Deferred on
arrival per the standing rule.

### 〈raised〉 Codex field report, 2026-08-20 — split for separate fixing

From a Codex agent's real usage (webgpu-engine work), relayed by the
maintainer. Items already in flight are marked; the rest stand alone:

- **`explore_symbol`: the similar-code tail can be noise.** Consider making
  the similarity section opt-in or self-trimming when relevance is low.
- **`investigate_code` anchors unrelated symbols on conceptual questions.**
  It should say "relationship not found" sooner instead of decorating a weak
  retrieval with verified-looking relationships.
- **Tool idea: evaluate declared execution grammar** — expand sequence
  repeats and indirect `count` into exact command multiplicity
  (webgpu-engine's dispatch grammar).
- **Tool idea: resource-flow trace** — writer → resource/view → reader,
  including bind-group assignments; wake/invalidation and hot-path work.
- **Check idea: call-argument keys the target config never consumes** —
  would catch an ignored `solver: "block"` hidden behind an object spread;
  TypeScript itself cannot see that contract lie through a spread.

### The scope clause has two phrasings

`callers` writes "across loaded projects" where `references`,
`file_references`, and `workspace_symbols` write "across every project loaded
this session". One fact, two sentences; the catalog should own the phrase
once. Observed 2026-08-19.

### A location is shown three ways

Tree rows under a file (`references`, `file_references`,
`document_highlights`), a `❯` pointer (`definitions`, `implementations`,
`type_definitions`), and a bannered group (`diagnostics`).

The distinction may be real — a single jump target is not a list, and a file's
problems are blocks rather than rows — but nothing states the rule, so the next
tool will pick by feel. Either write the rule down or collapse them.

### 〈raised〉 `references` at 3.24s on kek needs looking into

```
references { system.ts:303 } → 2 references
· 3.24s · 5 language-server requests totalling 2.63s ·
  slowest type-atlas/workspaceReferences 2.27s · first since the server started
```

Raised with calibration: under 1 second is the target, 2 seconds is "cope,
might be reality", 2.5+ probably indicates a problem. The observed call was
the first after a backend restart on webgpu-engine (3.5k files), so program
construction is inside the 2.27s workspaceReferences — but whether warm
calls also breach, and where the other ~0.6s of tool-layer time goes
(subject resolution runs definitions + a file read; per-row enrichment runs
the outline chain), is the investigation. Deferred on arrival per the
standing rule; the cost trailer that surfaced it is the instrument to
measure with. Observed 2026-08-19.

### `inspect_symbol` sections vary with server warmth

The same call — `inspect_symbol` on `TimelineExactCoordinate`, kek-monorepo —
answered with `## Implementations (5)` on a warm server and with no
implementations section at all on a cold one, forty minutes apart, code
unchanged. A section that silently disappears reads as "there are none," which
is the absence-honesty failure in section form. Which upstream request goes
empty on a cold project, and whether the section should say "unanswered"
rather than vanish, is undiagnosed. Observed 2026-08-19.

### The bridge prints a type containing torn source text

```
inlay_hints { edit-result.ts 12:1-30:1 }
→ 32:2 : Promise<{ [x: string]: unknown; _meta?: { [x: string]: unknown;
  rom "./mcp-result.ts"; import… }; }>
```

A return-type inlay hint's label — the provider's own type printout —
contains fragments of the file's import statements mid-type ("rom
\"./mcp-result.ts\"; import" is a torn `from` clause). The label reaches us
as the provider produced it; our layer now collapses and bounds it, but the
content corruption is the platform's — the tsgo bridge assembling display
parts from wrong spans, in the family of the shell-file walks. Upstream
(typescript-native-bridge) material. Observed 2026-08-19,
`packages/mcp/src/edit-result.ts`, the hint at 32:2.

### The bridge's project registry rejects its own project on the third service

```
Error: api: client error: failed to update snapshot: project not found for
update: /users/tylermitchell/projects/featuretype/…/.references-test-…/tsconfig.json
```

Creating and disposing plain language services in one process — the third
scaffold in a vitest file — makes the tsgo bridge's Go-side registry reject a
snapshot update for a project it should hold, and the path in the error is
lowercased where the real path is mixed-case, suggesting register and update
disagree on normalization. Sequence-dependent: the same test passes run solo.
Upstream (typescript-native-bridge) material, alongside the shell-file walks
and the isTsgoBackedProgram-before-sync throw; reproduce by running
`packages/language-server/test/references-probe.test.ts` whole. Observed
2026-08-19.

### `rename_symbol` will happily patch a dependency's declaration file

```
rename_symbol { newName: "workspacePackageOf" } → 12 files · 85 edits
*** Update File: @ark/schema/out/shared/jsonSchema.d.ts
```

A rename whose resolved declaration lives in an installed package produces a
patch that edits that package's `.d.ts` — under a header reading "Scope:
project only". Applied, it corrupts the installed dependency (and through
pnpm's hard links, potentially the store). A rename reaching outside the
workspace should refuse, or at minimum lead with that fact instead of
burying it as one file among twelve. Observed 2026-08-19: a drifted
position landed on the word `description` inside `.configure({...})` and
the tool renamed arktype's schema property surface-wide.

### `rename_symbol` never names what it is renaming

The same answer's whole preamble: "Rename to workspacePackageOf · Scope:
project only · packages/mcp/tsconfig.json · 12 files · 85 edits". The one
fact that would let a reader catch a mistargeted rename — the resolved
subject, `description [property] · @ark/schema/…/jsonSchema.d.ts` in the
location grammar every other tool pays for — is absent, so the misfire is
only discoverable by reading 85 edits. Every rename answer should lead
with what was resolved at the position, exactly as `references` does.
Observed 2026-08-19, same call as above.

### `rename_files` emits a confidently incomplete patch

```
rename_files { reference-groups.ts → located-rows.ts }
→ Rename · 3 files · 2 edits   (updates navigation.tools.ts, ambient-diagnostics.ts)
```

Ground truth: `document.tools.ts` also imports from `./reference-groups.ts`
(three importers, verifiable with `file_references`), and the patch omits it —
applied, it breaks the build while the header reads complete. The missed
importer is the one file of the three no call had materialized this session,
which matches the tsgo bridge's shell-file mechanism a third time (navigate-to,
the unrouted reference walk, now `getEditsForFileRename` walking shells).
Unverified whether priming heals this walk — the navigate-to probe showed
priming does not replace shell entries in the program list — so the fix
approach is open: a bridge-side routed path, materialization the walk
respects, or assembling rename edits from the (fan-out, working) references.
The worst failure class: a wrong answer about completeness in an answer meant
to be applied. Observed 2026-08-19.

### `search_dependency_code` can rank only results it then refuses to show

```
search_dependency_code { package: ["typescript"], query: "findReferencesTsgo …" }
→ No exported name matched this query …
  6 ranked outside this package and are not shown · the search root reaches
  past typescript-native-bridge, and source from a neighbour is not this package's
```

Twice in a row, every ranked result was filtered as outside the requested
package, so the caller gets nothing and no way forward. The package is the
pnpm `typescript` override (typescript-native-bridge), whose code is a few
multi-megabyte bundles under `lib/` — likely over the index's 1MB file cap —
so nothing inside the package can rank, and the root that was searched
reaches neighbours instead. The answer is honest about the filtering but
silent about why the package itself contributed nothing; a reader cannot
tell "query matched nothing here" from "this package is structurally
unindexable". Observed 2026-08-19 while chasing the bridge's implementation
routing. The needed searches were abandoned.

### `search_dependency_code` once answered with nothing at all

One call — `effect`, first touch, cold index of its ~1,500-file src — returned
a result with no content whatsoever: no absence sentence, no error, no
trailer. The design language's strongest rule is that an empty answer is a
sentence; a blank is unreadable in the worst way. Not reproduced: the
identical call answered fully warm (115ms), and cold builds of arktype
(123ms, persisted cache) and vitest (302ms, genuinely cold, dist-only)
answered normally. Suspect: the largest-build path under the 30s tool
timeout, or an all-error render reaching an empty document. One observation,
held as a rumour until it reproduces. Observed 2026-08-19.

### 〈raised〉 Dist-only packages are unsearchable, by our own root choice

```
search_dependency_code { package: ["@modelcontextprotocol/server"] }
→ Error: Failed to index '…/@modelcontextprotocol/server': No supported files found
```

Semble ignores `dist/` under a queried root — its policy, reasonably intended
— and dependency search roots at the package directory, so a package whose
code lives only in `dist/` indexes to nothing and errors instead of falling
back. `docs/semble-affordances.md` already prescribes the fix shape: "a
package root whose executable code lives only under `dist` produces no index,
while using that resolved entrypoint's top-level directory as the repository
root indexes the same published code normally." The declaration-directory
fallback exists for the authored-TS-absent case but never engaged here; the
root choice blocks the capability. Raised with the standing instruction to
question inherited constraints like this one. Observed 2026-08-19.

### Undeclared tool arguments pass silently, surface-wide

```
references { …, bogusKey: true }  → answers normally
diagnostics { …, file: "…" }      → answers normally, file ignored
```

`references`' schema has carried `.onUndeclaredKey("reject")` since the
evidence ledger recorded it, and a nonsense key still passes — so rejection is
inert at the enforcement seam, not missing from one schema. A typo'd or
misremembered argument silently degrades to defaults, which is how a `file`
argument read as a per-file diagnostics mode that does not exist. The fix
belongs where Standard Schema validation runs, once for every tool. Observed
2026-08-19.

### `dots` is a test-reporter tag that outlived its category

The `tap` and `annotations` tags left with `format/command.ts` and
`format/tap.ts` on 2026-08-19; `dots` (a vitest dot-reporter progress line,
`atlascii/src/document/tags.ts`) is the same category and remains, along with
whatever component backs it. Same scope decision, same direction. Observed
2026-08-19.

### 〈raised〉 `quorl` repeats the same path on every row

```
├  coordinate · packages/core-time/tests/clock/exact-time.test.ts:147:9 · …
├  coordinate · packages/core-time/tests/clock/exact-time.test.ts:134:9 · …
├  coordinate · packages/core-time/tests/clock/exact-time.test.ts:124:9 · …   (×7)
```

Seven siblings each spend ~50 characters restating one file — the redundancy
the file-becomes-a-level rule exists to remove, and the grouping affordance
already exists (`located()` in `packages/mcp/src/inspection-variables.ts`, the
rule in the design language). Raised as a scalable-grouping exploration: the
closure tree nests by call structure, not by file, so the fix is a judgment
about where file grouping applies inside a structural tree — possibly a shared
mechanism other structural answers reuse. Observed 2026-08-19, kek-monorepo,
`quorl` on `exactCoordinateOnClock`.

### `find_successor` cannot see a successor that changed vocabulary

```
find_successor { name: "navigationNoun" }
→ Candidates (3): navigationItems, navigationTargets, registerNavigationTools
```

A real deletion from the same session: `navigationNoun`'s actual successor
is `subjectAtPosition`, and it is absent from the candidates because
candidacy is lexical — "shares navigation" — so any succession that renames
the concept (the common case in a real refactor) is invisible. The
files-discussing list does point at the right files, and the caveats are
honest, but the tool's own contract ("what currently occupies its role")
goes unmet exactly when the role was renamed. Observed 2026-08-20,
featuretype, after deleting navigationNoun. (The same observation's
duplicate files-discussing rows were fixed 2026-08-20 — one row per file,
witnessed in `find_successor/close-miss-finds-the-successor`.)

```
Search: Related to packages/core-time/src/clock/offset.ts:75
3 matches · relevance is relative to the strongest match · nothing here declares Related
```

The related-code sub-answer reuses the search preamble with an internal
pseudo-query ("Related to <path>"), so the declares-a-name clause treats the
literal word "Related" as the searched identifier and reports its absence — a
sentence about nothing a caller said. The label grammar exists for queries a
caller typed; a similarity seed is not one. Observed 2026-08-19, kek-monorepo,
`explore_symbol` on `exactCoordinateOnClock`.

### `investigate_code` ranks an import block as its best answer

```
investigate_code { question: "how does the transport advance the timeline position each frame" }
→ === 1 · packages/core-time/src/framework.ts:210-240 · relevance 100% ===
  210 |   TimelineLatestEventInput,
  211 |   TimelinePosition,   …
```

The top-ranked snippet is thirty lines of import/export names — it names every
timeline concept, so it outranks the code implementing them, and it answers a
behavioral question with nothing a reader can act on; the real answer (the
frame loop) ranked third. `dependency-search.ts` already holds the affordance
for exactly this class (`modulePreamble`, written because a CommonJS export
banner outranked implementations); the retrieval side of `investigate_code`
and `search_code` never adopted the judgment. The missing structure line on
such a match is the tell: a snippet anchored to no declaration is usually a
module's plumbing, not its behavior. Observed 2026-08-19, kek-monorepo.

### `investigate_code` titles its sections `###`

Every other tool uses `##`. Caught by the document lint's heading rule only
after it was written; the lint now holds it.

### Marks reach the components but not the partials

`asciiMarks` overrides exactly two entries — `separator` (`·` → `-`) and
`detail` (`—` → `--`). Both are honored where `rowBranches` composes a line;
every partial types the punctuation itself, so a partial-composed answer ignores
them.

Withdrawn from the server rather than half-offered: `TYPE_ATLAS_MARKS` is not
read, and `Marks` stays available to a consumer calling the components directly,
where it does work. The reasoning is at `presentationFromEnvironment` — an MCP
answer travels as JSON-RPC to a client that renders it, never to a terminal this
process can see, so an ASCII mark set answers a question this path does not ask.

Closing the gap properly would mean a `mark` call at roughly forty partial
sites, making the documents — the design artifact a successor reads — harder to
read to serve two characters. Worth revisiting only if a consumer appears that
genuinely needs ASCII-only output.

---

### `callees` drowns the project in the standard library

`callees` on `balancesAsOf` (ledger fixture) answers 12 callables of which
eight are `lib.*.d.ts` methods — `localeCompare` three times, once per lib
file that redeclares it. The four project calls, which are the answer, sit
under a pile of `map`/`sort`/`get`/`set`. Standard-library callees deserve a
one-line fold ("+ 6 standard-library calls"), not rows that outnumber the
signal. Observed 2026-08-20 in
`responses/callees/what-balances-as-of-invokes.txt`.

## Architecture

### `atlascii` still carries test-reporter output formats

Removed: `format/terminal.ts` (ANSI cursor control for a live view) and
`format/xml.ts` (JUnit escaping). Neither had a consumer beyond its own
re-export and its own test.

Still present, because each is reached by a tag and so is live API rather than
dead code: `format/command.ts` with `components/annotations.ts` (GitHub Actions
workflow commands), and `format/tap.ts` with `components/tap.ts` (TAP). They are
test-reporter output, not code intelligence, and this library describes itself as
the latter. Removing them removes the `annotations` and `tap` tags with them,
which is a scope decision about what `atlascii` is for rather than a cleanup.

### The design language's bug appendix drifts from this file

`atlascii/docs/design-language.md` closes with "Bugs the audit surfaced",
restating entries from here. It already disagrees with reality: the nested-root
`search_dependency_code` failure it lists is fixed (verified 2026-08-19 —
`messageformat@4.0.0` resolved and searched with `atlascii/` as the workspace),
and its `workspace_symbols` paragraph carries a withdrawn diagnosis. A defect
recorded twice is fixed once; the appendix should point here rather than
restate, or carry only what is structural to the design.
