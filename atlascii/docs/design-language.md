# The design language

What a code intelligence answer looks like, and why each part looks that way.

The reader is an agent scanning for structure, not a person browsing. It reads
the whole answer at once, cannot scroll back cheaply, and acts on what it finds.
That reader is the only justification any rule here has. Where a rule stops
serving it, the rule is wrong.

Every tool answers in the same three parts, in this order. Nothing else is a
part; a tool that seems to need a fourth is describing one of these three badly.

## 1. Preamble — what was asked, and how far the answer reaches

Two lines, in the grammar the rest of the surface already speaks — never a
paragraph. The first line is the subject in the location grammar; the second
is the result's facts as segments:

```
indentGuide [const] · src/layout/hierarchy.ts:54:14
7 references · 2 projects loaded · tsconfig.json
```

Prose belongs to absence and explanation, and only there. A presence header
written as sentences buries five facts in one run-on clause — subject, kind,
count, scope, anchor — and each tool phrases the sentence differently, so the
same fact reads differently across siblings. Segments carry one fact each,
in one order, in every tool: what follows `inspect_symbol`'s header and the
diagnostics summary line is the same form here.

The scope segment is not decoration. "2 projects loaded" is the difference
between *this name is unused* and *this name is unused in what has been
opened* — and a reader that cannot tell those apart deletes working code. The
count is what makes the claim weighable; "every project loaded" reassured
where "1 project loaded" warns.

Not the workspace root. The caller passed it, so restating it hands back their
own argument — and it is the one absolute path that would otherwise appear in
every answer, in a surface whose paths are workspace-relative by default. Where
a path genuinely cannot be relative, `displayPath` renders it absolute and says
so by being absolute.

Counts belong here when they describe the answer as a whole, and in the banner
when they describe one subject. They are never in both.

## The kind word — nature over storage

A symbol's bracketed word states its **nature**: what it declares into the
program. Storage words survive only as the residual when nature is not
visible. The rule resolves every conflation the upstream vocabularies carry,
because they answer two different questions — `const`/`let`/`var` say how a
binding is held; `function`/`class`/`interface`/`type` say what the thing is
— and a surface that mixes the axes makes one declaration wear two words
across sibling answers.

- A `const` holding a callable is a **function**. How the binding is held is
  not what the thing is.
- A type alias and an interface are both type-level; the protocol has no
  alias kind, so both project to Interface — one word, consistently, rather
  than Interface in one tool and Class in its sibling.
- `const x = 5` stays a **constant**: immutability is its nature, not merely
  its storage.
- Member words (`method`, `property`, `getter`) are placement, kept because
  placement is what a reader scans a container for.

One vocabulary, one projection: TypeScript's kind strings and the protocol's
numbers both map through the same decisions, and a new mapping site copies
the decision, never re-makes it. The residual: the protocol's numbers cannot
say "type alias" — carrying TypeScript's own strings end to end is the
follow-up that removes the projection entirely.

## 2. Banner — the subject a reader reads *through*

```
=== src/config/marks.ts · 108 lines ===
```

A heading says a section starts here. A banner says everything below belongs to
this until the next banner. A file's contents, a package's surface, a symbol's
report, and one ranked search hit are all the second kind: a reader scanning
several needs to see where one ends without counting blank lines.

Written `{% banner %}…{% /banner %}`, taking its name as children because that
name is composed — a path, a count, a windowed range, each under its own
condition. What encloses it is a mark, so a consumer that cannot render `===`
changes one setting and every banner follows.

Headings (`##`) remain, and mean the other thing: a named part *within* one
subject. `## Callers` under a symbol's banner is a section of that symbol's
report, not a new subject.

## 3. Body — the content, in one of five forms

The whole vocabulary. A tool needing a sixth is a real finding; a tool inventing
one privately is the failure this document exists to prevent.

| form      | what it shows                                   |
| --------- | ----------------------------------------------- |
| `tree`    | entries with things beneath them                 |
| `source`  | verbatim lines behind a numbered gutter          |
| `frame`   | source around a position, carets under the span  |
| `table`   | columns, when every row has the same fields      |
| `summary` | labelled values aligned to one column            |

`tree` dominates because most of what a language server answers is one shape: a
label with things beneath it. A file with the sites in it, a call with what it
reaches, an outline with its declarations, a package with its exports.

### A location, and when its file becomes a level

Most of what this surface answers is *a place, and what stands there*. It is
written one way:

```
name [kind] · path:line:column · range … · what else is true of it
```

Whether the path leads its own level is a judgement about the data, never about
which tool is answering. Grouping saves repetition — thirteen uses in one module
printed the same forty characters thirteen times — and costs a header line and a
connector. So:

**A file becomes a level when some file holds more than one location. Otherwise
the path stays on the line.**

One file earning it groups the whole answer, because a list that grouped some
files and not others reads as two answers. Under a group the positions are
padded to the widest of that group; flat, each line starts with a different
path, so there is no column to hold to and none is carried.

This replaced three renderings of one fact. `definitions` wrote
`❯ file:range`, `document_highlights` wrote a file header with a single
connector beneath it, and `diagnostics` bannered the file — all for the same
symbol at the same position. The `❯` was the tell: a glyph only some tools wore,
chosen per tool rather than by any rule, which is what a decoration is when
nothing decides it.

`diagnostics` keeps its banner, and that is not an exception. Its contents are
*blocks* — a message, sometimes a framed excerpt — not rows, and a banner is
what marks a subject a reader reads through. The rule is about rows.

Anything that is a *line* rather than a form is composed by markup, in the
document, out of `tight`, `indent`, and conditionals. A module export
(`kind name [deprecated]: signature`) and a signature with its documentation
beneath were both components once; each decided a line's shape for every
document at once, and neither owned any logic that `tight` and `indent` did not
already express.

### Wrapped values

A label may span lines — a type signature is the usual reason. The continuation
is always indented one level past its label, at every depth including the root.
At depth one and beyond the guide was already drawing something there; at the
root it draws nothing, and an unindented continuation is indistinguishable from
the next entry.

## The remainder

Every bounded answer must say what it left out. The mechanism is a page line:

```
8 of 81 exports shown · pass offset: 8 for the rest
```

Naming the parameter is not pedantry. The line previously read `ask from 8 for
the rest`, which states a number and leaves the reader to guess which argument
carries it — and a reader that has to guess does not act. `list_module_exports`
was worse still: it printed the count and no way forward at all, because the
handler built its page without the `next` the pager already computed. So the
tool announced a gap it gave no means to close.

**But a cursor is the weaker half of this primitive, and it is worth being
honest about why.** Paging is rational only when the page is close to what the
reader needs. Enumerating 81 exports eight at a time is eleven round trips; the
correct move at that ratio is to widen the limit, not to page, and that is what
a reader will do. Pagination earns its place in a narrow band: when the total
exceeds what one call can return at all, or when the reader is scanning toward
something and can stop early.

Which means a page line whose whole content is a count is the worst case. It
announces that something is missing and gives no basis to judge whether it
matters, so the rational response is always to ignore it. That is the shape of
a primitive that goes unused.

The stronger half is already in the language, in the tools that state what was
excluded rather than merely how much:

```
5 ranked outside this package and are not shown · the search root reaches past
chokidar, and source from a neighbour is not this package's
```

```
Dependency/runtime: map, reduce, split
```

Both let a reader decide without spending a call. **A remainder should be
characterised, not just counted** — lowest-ranked, all in tests, all deprecated,
all in one file — with the cursor as the escape hatch for when the
characterisation is not enough. Where a tool knows its own sort key, it knows
enough to say what the tail is, and saying so is cheaper for both sides than
the call it prevents.

## Absence

An empty answer is a sentence, never a blank. It names what was looked for, the
mechanism that found nothing, and what would answer differently.

```
Nothing at this position is callable, so nothing can call it. Callers reports
what invokes a function or method, and the call hierarchy prepared none here.
```

This is the strongest part of the language and the least negotiable. A reader
that cannot distinguish *absent*, *unanswered*, and *not loaded* will conclude
the wrong thing every time, and the three are indistinguishable from an empty
body.

Zero states are never printed as `0`. A count of zero rendered as content reads
as content.

## Style and meaning

The distinction the whole configuration rests on.

**Style is config.** How depth is drawn, which glyphs, which punctuation, which
words, how wide. One setting, applied to every tool at once, chosen by the
consumer and never by a document.

**Meaning is data.** What kind of thing a row is, what happened to it, where it
came from. A fact about the row, carried on the row, surviving whichever style
draws it.

A path is the same split. Which file it names is identity; whether it reads as
`src/app.ts`, `/repo/src/app.ts`, or `src/app.ts` measured from the package that
holds it is style — `{ paths: "workspace" | "absolute" | "project" }`, workspace
by default because the root is stated once in the preamble and repeating it on
every row costs more than it tells. Naming a file by its package rather than by
where a package manager installed it is *not* a style: `chokidar/index.js` is
what that file is, and the directories that mean "installed here" are a list so
that adding a language adds a name rather than editing a renderer.

The nesting guide is where the two are easiest to confuse, so it is worth being
concrete. These three are the same information:

```
connectors            indent                markers
src/app.tsx           src/app.tsx           src/app.tsx
├  10:3 open            10:3 open             ↳ 10:3 open
└  14:7 close           14:7 close            ↳ 14:7 close
```

A consumer picks one — `{ guide: "connectors" | "indent" | "markers" }` — and
every tool changes together. Over MCP that is `TYPE_ATLAS_GUIDE` in the
environment the client launches the server with, alongside `TYPE_ATLAS_PATHS`
and `TYPE_ATLAS_GLYPHS`; the server names them once at start, before anything
renders.

`Marks` is configurable in the library and deliberately not offered over MCP:
its ASCII variant changes two characters and reaches only the lines the
components compose, so advertising it would be a setting half the tools ignore.

Which is why `resolve()` reads three layers, narrowest first: what this call
named, what the host chose for the process, what the library defaults to.
Threading a config object through every component and every path rendering
would put a parameter nobody reads into ninety call sites, and the one that
forgot it would answer in a different style from its neighbours — the exact
divergence this section exists to prevent. Connectors are the default: they are the only
style that stays unambiguous past one level and the only one that shows where a
group ends.

A row's own marker is not this:

```
✓ src/index.ts (5 tests | 2 skipped)
├  ✓ passing case
└  □ pending case
```

`✓` and `□` say what happened. They survive every guide because they are not
depth. Encoding depth in that field instead — `▸` at the top, `·` beneath — is
how a caller ends up with a presentation nothing can change, and it is the
mistake this separation exists to make visible.

A document may override the guide with `{% tree guide="indent" /%}`, but only
where the variant carries meaning rather than taste. Taste belongs to the
consumer.

## Why one tag, and what it cost to learn

There were three ways to put things beneath a label: a `tree` tag with
connectors, a `rows` tag with indentation, and — in the partials that rendered
references, locations, and diagnostics — `{% tight %}` wrapping `{% indent %}`
wrapping `{% each %}`, drawing nothing at all.

The first two were identical but for one argument, so which style a reader got
was decided by which tag name a document happened to type. The third could not
respond to a style setting even in principle, and it covered the most-used
outputs in the surface: `references`, `file_references`, `document_highlights`,
`document_links`, and every group inside `inspect_symbol`.

Nothing here was a bug in the sense of a wrong line. Each was locally sensible
and the divergence was invisible from inside any one document — which is why
this document exists, and why the shape of nested data is fixed rather than left
to each builder:

**A node's children are always `children`.** Not `rows`, not `sites`, not
`problems`. The guide reads that one relation, so a shape that names it
otherwise can only ever be nested by markup written for that name — which is
exactly how three drawings of one shape came to be.

## What is enforced, and what cannot be

`packages/core/src/markdoc/documents.lint.test.ts` asserts the rules above
against the documents themselves — no fixtures, nothing rendered. It reads what
the documents say, so it cannot drift from them:

- no document draws a banner by hand
- every tool states which nothing it is, counting the partials it includes
- sections are one heading level
- every partial is reached, and every partial named exists
- nesting goes through the guide, never `indent` wrapping `each`
- a ranked hit is written one way

Each of those exists because the surface diverged that way. On its first run it
found a dead partial and a tool that reported a count with nothing after it.

What no static rule can judge is whether a line *reads*. That is answered by
calling the tool and looking at the answer — which costs one request and is the
real output rather than a reconstruction of it. Hand-written fixtures were tried
and abandoned: within minutes one of them depicted a shape no handler produces,
and a gallery that lies confidently is worse than none.

## Confidence a tool does not have

Two tools state conclusions their evidence does not support, and both are worse
than saying less.

`search_code` ranks by meaning, and its relevance is *relative to the strongest
match*. A query of pure nonsense returns results at 100% and 92%, because the
best of a bad set is still the best. Nothing in the answer distinguishes "this
is what you asked for" from "this is the least unlike it", and an absent
result — the honest answer — is one the tool cannot produce.

`find_successor` reported `Removed` from an empty symbol index, for a name
declared in a loaded project that `references` finds seven uses of. It now
states what the index holds rather than what the repository contains.

The rule both violate: **a tool may report what it observed, and may not report
what that observation implies about the world.** Ranking is an observation;
"this is relevant" is a conclusion. An empty index is an observation; "this was
removed" is a conclusion.

## Where the language is not yet coherent

Stated rather than hidden, because a successor reading this should know what is
settled and what is still drifting.

- **`investigate_code` titles its sections `###`** where every other tool uses
  `##`. Authored as `{% sections %}`, which takes a level, so a lint reading the
  document source cannot see it — only the rendered answer shows it.
- **`workspace_symbols` omits the position**, reporting `Guide [interface]
  src/layout/hierarchy.ts` with no line to jump to, while `document_symbols`
  gives one.
- **A query is echoed as a label, and everything else is a statement.** That is
  correct — arbitrary user text of unbounded length breaks any sentence it is
  spliced into, and `Search: <query>` on its own line delimits it. It is written
  down here because the rule was once "over-generalised to statements", which
  produced a preamble where the query ran into the clauses after it.
- **Some marks are still typed into documents.** `·` and `:  ` appear as
  literals in partials, so `asciiMarks` does not reach them.
- **`kindAt` in `navigation.tools.ts` reads TypeScript hover text** with a
  regex for `const|let|var|function|class|interface`. Every other kind in this
  surface comes from the protocol's own `SymbolKind`, which is language-neutral;
  this one would silently answer wrongly for any language added later.
- **Presentation is process-wide, not per-consumer.** `configurePresentation`
  is module state, where a modern library would hand back a configured
  instance. Truthful for an MCP server — one process, one client, one style
  decided before the first answer — and wrong for anything serving two
  presentations at once. The reasoning is recorded at the function.

## Bugs the audit surfaced, which are not presentation

Recorded here because they were found by driving the surface, and a reader of
this document is the person most likely to hit them next.

- **`workspace_symbols` answers empty for a loaded project.** `indentGuide` is
  declared in `atlascii/src/layout/hierarchy.ts`; `document_symbols` lists it
  and `references` finds seven uses, so the project is loaded. Asking
  `workspace_symbols` for that name returns nothing, in 7ms — the signature of
  an index that was never consulted. `find_successor` is built on the same
  index and inherits the false negative, which is why its verdict now states
  what the index holds rather than what the repository contains.
- **`search_dependency_code` fails from a nested workspace root.** With
  `workspace` set to `atlascii/`, resolving `messageformat` reaches
  `node_modules` hoisted to the monorepo root, and `getWorkspaceUri` refuses any
  path outside the workspace: `File is outside the workspace: …`. The same query
  with `workspace` set to the monorepo root answers. The containment check
  exists for a reason, so the fix is a real decision about how dependency reads
  are scoped rather than a loosened predicate.
