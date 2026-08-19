# The Composition Language — Design Draft

Status: a draft for review, written 2026-08-19 from one day of building and
using the `compose` seam. Nothing here is implemented beyond what it cites as
shipped, and nothing shipped is demolished by this document. The maximalist
form described here is a deliberate design arc, not an accretion plan.

## Premise

Agents author and compose their own code-intelligence queries in a semantic
markup language. The shipped `.mdoc` documents are not a separate system —
they are house-authored instances of the same language, and the day the
language is whole, a dedicated tool's answer and an agent's composition are
the same kind of artifact.

This is exactly the target stated for it: not TypeScript composition, not a
spec layer in front of markup, and not presentation authoring as the point —
the markup is the *query* language, and presentation is the surface's job
unless the composer takes it.

## What exists, verified

- The `ask` seam: declarations in markup (`{% ask "references" as="uses" … /%}`),
  read off the parse without leaking the engine, fulfilled concurrently or in
  document order, canonical rendering when no body is authored.
- Chaining: `files=$uses.paths` reads an earlier answer; backward or unknown
  references refuse with the rule stated. One composition today expresses
  "find the uses, then check the health of every file holding one."
- A proto-ontology: `protocol/shapes.ts` already declares itself "the
  library's real interface", and `LocationNode` — a place and what stands
  there, with the one `children` relation every guide reads — is the shape
  most answers already pass through on their way to text.
- A presentation kit that is genuinely good: hierarchy with guides, source
  windows, banners, tables, CLDR plurals, and the absence-sentence
  discipline.

## Why this is not yet a language

1. **Ops bind bespoke records.** `references` binds `{groups}` shaped for one
   partial; `outline` binds `{tree}` shaped for another; the fields are
   documented in a tool description string. The shapes are cousins of
   `LocationNode`, but nothing makes them the same value, so nothing composes
   across them.
2. **The algebra is nearly absent.** Chaining passes one list into one
   hand-wired plural parameter. There is no per-item fan-out, no filter or
   projection, no aggregation. Without those, a composition is a batch call
   wearing markup.
3. **Presentation is addressed by artifact.** A composer writes
   `partial="reference-node.mdoc"` — an internal filename leaking into the
   public language.
4. **There is no spec.** The design-language document governs prose and
   answer forms; the compositional grammar has no document at all. This
   draft is its beginning.

## The ontology

A small set of value kinds. Every query operation emits only these (plus
scalars and lists of them); every presentation primitive accepts them by
kind. Each is seeded by a shape that already exists:

- **location** — a place and what stands there: `LocationNode` as declared.
  References, outlines, workspace symbols, callers, definitions are all
  lists or trees of locations; today they differ only by accident of the
  handler that shaped them.
- **problem** — `Diagnostic` as declared, with the file on the value.
- **excerpt** — source lines with the number the first line carries; the
  `source` tag's input today.
- **prose** — signature-and-documentation markup text; hover's value.
- **count** — a named tally (`CountState`), for count lines that suppress
  zeros.

The rule that makes it an ontology rather than a type list: **an operation
may not invent a field a renderer must learn.** If an answer needs a fact no
kind carries, the kind grows — once, for every producer and consumer.

## The algebra

Uniform inputs and a small set of composition primitives, each named with the
real scenario that justifies it and the bound it must announce:

- **ask** — fetch: an operation, a subject, a binding. Shipped.
- **reference** — `$bind.field` in an ask's attributes reads an earlier
  answer. Shipped, document-order only, refusal on backward reads.
- **fan-out** — an op over a list, one answer per item, bounded and stating
  its bound ("checked the first 5 of 12"). Half-shipped: `diagnostics` takes
  a file list; the primitive should belong to the language, not to one op.
- **selection** — filter and projection on ontology fields: locations in
  test files, problems of a severity, the first N by a stated order. Not
  designed; every use of it must announce what it dropped.
- **aggregation** — counts over selections, feeding `count` values. Not
  designed.

What is deliberately absent: joins, recursion, and anything that makes a
composition's cost unpredictable from reading it. A composition should be
priceable by eye: one ask is one answer's cost, a fan-out is its bound times
one.

## Kind-addressed rendering

The canonical form of each ontology kind is the language's, not the
composer's: hand the renderer locations and the location form appears —
grouped by file when grouping saves repetition, flat when it does not, the
same judgement `referenceGroups` already makes. Partial filenames become
internal. A composer who wants a different shape still has the full document
layer; the default asks nothing of them.

An engine constraint discovered by trying (2026-08-19): Markdoc refuses the
`partial` tag inline — "'partial' tag should be block" — so a phrase or a
kind rendered mid-sentence must be a tag or a function, never a partial.
Kind-addressed rendering is therefore tag-shaped (`{% locations of=$x %}`),
and sentence-level phrases stay written in each document, which the
sentences-belong-to-documents rule wants anyway.

## Migration shape

Ordered by dependency, no calendar:

1. Ops re-bind to ontology kinds (additive; canonical sections keep
   rendering).
2. Kind-addressed renderers land; partial names leave the tool description.
3. The shipped tool documents rewrite onto the same primitives — the
   dogfooding that proves the language can express its own house answers.
4. The spec replaces this draft.

Step 3 is the honest test of the whole idea: if our own documents resist the
language, agents' compositions will too.
