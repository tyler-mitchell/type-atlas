# Where composition can live

atlascii is markup-oriented: a tool's answer is composed by a `.mdoc` document,
not assembled by a caller. This records how far that reaches, because the limit
is not a preference — it is what the current document engine can and cannot
express, and each limit below was established by making the engine fail.

Every claim here has a test. If the engine is ever replaced, those tests are the
specification the replacement has to meet.

## What markup owns

Everything about the shape of an answer:

- Which blocks appear, in what order, and under what titles.
- Whether a section appears at all, from the data (`{% if any($x) %}`).
- The wording of every sentence a tool emits.
- Repetition over a collection, via `{% each %}` and a partial.
- Multi-line assembly at full density, using inline `{% if %}` and a trailing
  `\` hard break, so a conditional field does not cost a blank line.

`search_code` and `search_dependency_code` are composed this way end to end,
including the conditional `· range` and `· declares a name the query asked for`
segments of a symbol line. Neither has a composition component behind it.

## What markup cannot own, and why

### Iteration needs a partial, not children

`Markdoc.transform` deep-resolves the whole tree against one set of variables
*before* any tag's `transform` runs, so a tag's inline children arrive already
flattened — there is nothing left to bind a per-item name to. A partial is held
as raw source, so it can be resolved and transformed again per item.

This is why `{% each %}` takes `partial=` rather than a body. A loop whose body
is children cannot work in this engine, and a partial written against that
assumption fails the moment anything includes it.

> `repeats a partial once per item, binding each to a name`
> `cannot bind a per-item variable to inline children, only to a partial`

### Indentation cannot survive markup

Markdown owns leading whitespace: it means code block, or it means nothing. A
document cannot say "two spaces here" and be obeyed.

Anything whose meaning is carried by nesting — a location grouped under its
file, a call hierarchy, an outline — is therefore drawn by `hierarchy` with a
guide, and stays a component. That is layout, not composition: the component
decides *how deep* reads, never *what is said*.

> `cannot carry leading indentation through markup`

### A document has no arithmetic and no plural rules

`{line: 32, character: 13}` becomes `33:14` by adding one to each — the protocol
counts from zero and a reader counts from one. Markdoc cannot add. Nor can it
choose between CLDR plural categories, or map a numeric `SymbolKind` to a word.

These are value functions (`rangeText`, `plural`, `symbolKind`, `breadcrumb`)
and they are invoked *from* markup, as functions and tags. A document still
decides where the value goes and what surrounds it.

### Absence is not the same as a missing key

The validator walks a variable path asking `hasOwnProperty` of each step. A
missing key reports an undefined variable and stops; a key present holding
`undefined` passes that check and leaves the next step asking `hasOwnProperty`
of nothing, which throws before the document renders a character.

Handlers hand over `undefined` for what an answer does not have, so the pipeline
strips undefined-valued keys before validating. Without that, every optional
field in every handler is a crash waiting for the shape that omits it.

Related: `{% if %}` counts `0` as true. Ask `{% if any($count) %}` for a number.

## The shape this forces

    language server  →  handler        →  document        →  component
                        selects data      composes it        measures and draws

A handler selects: which results survive a limit, how they group, what order
they read in. It builds no text. A document composes: sections, sentences,
repetition, conditional fields. A component measures and draws what markup
cannot express: indentation, connectors, aligned gutters, column widths.

If a component is composing — deciding that a heading comes before a list, or
what a sentence says — it is in the wrong layer, and `{% each %}` plus a partial
is how it moves.
