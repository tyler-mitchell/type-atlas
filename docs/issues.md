# Issues

Things the MCP surface does that it should not, or does not that it should,
found by using it. Written at the moment of discovery, because a finding
deferred to the end of a session is a finding lost.

Every entry states **how it was observed**, because a finding without a
reproduction is a rumour, and the next reader needs to confirm it still holds
before acting on it.

An entry leaves this file when it is fixed, not when it is explained.

**〈raised〉** marks an issue Tyler raised rather than one found while working,
whether or not the message said `issue:` — anything he points out that reads as
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
2. **Ground `kindAt` in `SymbolKind`.** Language-neutral, and required before a
   second language is worth attempting — not before release.
3. **Retire the terminal-control exports**, or find the consumer that justifies
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
deprecated *what*, inside *which* declaration — breaking the surface's own
location grammar (`name [kind] · path:pos`), which every reference row already
pays for through the declaration chain (`within`). A reader must open the file
to understand any row. The enrichment affordance exists and is in use one tool
over; diagnostics rendering never adopted it. Applies to the ambient block and
the diagnostics tool alike. Observed 2026-08-19, and consumed twice in passing
before being caught — by Tyler, not by the session.

### An absence branch asserts a conclusion the tool cannot know

While the symbol index was broken (2026-08-19, since fixed),
`workspace_symbols` still explained its empty answer: *"this is absent from what has been opened, not from the repository"*.
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

### `inspect_symbol` sections vary with server warmth

The same call — `inspect_symbol` on `TimelineExactCoordinate`, kek-monorepo —
answered with `## Implementations (5)` on a warm server and with no
implementations section at all on a cold one, forty minutes apart, code
unchanged. A section that silently disappears reads as "there are none," which
is the absence-honesty failure in section form. Which upstream request goes
empty on a cold project, and whether the section should say "unanswered"
rather than vanish, is undiagnosed. Observed 2026-08-19.

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

### `explore_symbol`'s related section declares "Related" a name nobody asked for

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
