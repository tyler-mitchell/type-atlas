<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `compose`

Answer several questions about code in one call, laid out how you want. `{% ask %}` tags declare data and render nothing; the body you write is the whole answer.

Each ask is named for the tool that answers it and answers as that tool does. Point one at a declaration by name with `symbol="foo"`, or at `line`/`character` (one-based). Every ask also binds `.text`, already rendered, so the shortest useful composition is two lines and needs nothing memorised:

{% ask "references" as="uses" file="src/x.ts" symbol="foo" /%}
{% $uses.text %}

Asks, and the fields each binds besides `.text`:
- inspect_symbol → {text, symbol, documentation, mentions, callers, callees, implementations, typeDefinitions}: the whole working view of one symbol in one ask — what it is, who uses it, what it calls. Start here; reach for the single-relationship asks below when you want one of them in full. `includeSource=true` adds its body
- hover → {text}: signature and documentation
- subject → {name, kind, file, at}: what a position resolves to
- references → {total, files, paths, projects, groups}; also takes `tests="only"` or `tests="exclude"` to narrow the uses it already found — "which tests cover this" against "what breaks if I change it". That split is a path heuristic (a `tests/` directory, a `.test.`/`.spec.` name), not something the compiler knows
- definitions | type_definitions | implementations → {total, files, paths, groups}
- file_references → {total, files, paths, projects, groups}: who imports this module, which is not what the uses of any symbol in it answer — ask it before moving or deleting a file
- callers | callees → {name, total, groups, dependencies}; calls into dependencies are named in `dependencies` rather than listed as rows
- document_symbols → {total, tree}; `depth` opens nested levels, `raw` keeps everything
- diagnostics → {total, groups, checked, of}; takes `file`, or `files=$uses.paths` from an earlier ask
- read_file → {lines, startLine}; `from` and `to`
- occurrences → {text, subjects, total, any}: exact identifiers resolved to their references, with an honest zero when a name occurs nowhere; takes `query`, and `path`, `limit`, `symbolLimit`. `subjects` are the declarations it resolved, as places, so `each=$found.subjects` asks about each one
- list_files → {text, files, total, any}: the file tree, for orienting before you know any path; takes `directory`, `glob`, `depth`, `limit`, `changed=true` for the working-tree delta. `files` is workspace-relative, so `each=$tree.files` walks what it found
- search_code → {text, hits, total, of, any, file, line, character}: find code by what it does when the name is unknown, each hit anchored to a language-server symbol; takes `query`, and `directory`, `limit`, `snippetLines`. `hits` are places, so `each=$found.hits` asks about everything it found, and `file`/`line`/`character` point at the first. `of` is how many matched before anchoring — a hit landing in import statements has no declaration to ask about
- workspace_symbols → {total, projects, hits, file, line, character}: find a declaration by `query` across loaded projects, where `file` only picks which project to search from. Binds the first hit's location, so the next ask can point at it: `file=$found.file line=$found.line character=$found.character`

An ask can also run once per item of a list an earlier ask bound, instead of once at one place: `each=$found.hits` hovers every candidate a search returned, `each=$uses.paths` outlines every file using a symbol. A string item fills `file`; an object item fills the attributes it has fields for; anything you write on the tag yourself stays fixed. It binds {items, total, of, text}, and each item carries its own answer plus a `title` — so `{% $heads.text %}` is already a titled block per item, and `{% sections items=$heads.items /%}` is that same thing when you want to lay it out yourself. Bounded to 10 items; `of` is how many the list held.

To guard a section, use the boolean: `{% if $uses.any %}` on its own line, with the heading and body under it. A count does not work — `{% if $uses.total %}` renders on zero, because the engine asks whether the value is there, not whether it is nonzero. Every countable ask binds `any`.

Every ask that answers with places — references, definitions, type_definitions, implementations, file_references — lists at most `limit` sites (50 by default) and binds {shown, beyond} beside {total}. The text says what it cut, and `tests="only"`/`"exclude"` narrows before the bound applies.

`paths` is a list to hand to another ask, not text to print — interpolating it runs the paths together. The file list is already in `.text`.

For a layout of your own, use the fields with the shipped tags: {% tree entries=$uses.groups partial="reference-node.mdoc" /%}, {% tree entries=$calledBy.groups partial="call-node.mdoc" /%}, {% tree entries=$shape.tree partial="symbol-node.mdoc" /%}, {% each items=$problems.groups as="group" partial="diagnostic-group.mdoc" /%}, {% source lines=$body.lines startLine=$body.startLine /%}.

Asks fulfil in document order and a later one may read an earlier bind. A failing ask is named in a line under the answer; the rest still render.

## settlement dossier

**Agent's Input**

```yaml
tool: Compose
workspace: fixtures/ledger
document: {% ask "subject" as="what" file="packages/accounts/src/posting.ts" line=25 character=14 /%}
{% ask "references" as="uses" file="packages/accounts/src/posting.ts" line=25 character=14 /%}
{% ask "diagnostics" as="health" file="packages/accounts/src/posting.ts" /%}

## {% $what.name %} · {% $what.file %}:{% $what.at %}

{% $uses.total %} uses across {% $uses.files %} files · {% $health.total %} problems in the declaring file

{% tree entries=$uses.groups partial="reference-node.mdoc" /%}

# answered in 46ms
```

**Response**

~~~text
## signedAmount · packages/accounts/src/posting.ts:25:14

9 uses across 5 files · 0 problems in the declaring file

packages/accounts/src/index.ts
└  12:39 — at module level
packages/accounts/src/journal.ts
├  3:39  — at module level
└  52:12 — inside post
packages/reconcile/src/drift.ts
├  4:24  — at module level
└  20:37 — inside journalTotal
packages/reports/src/balance.ts
├  6:3   — at module level
└  34:57 — inside balancesAsOf
packages/rules/src/builtin.ts
├  1:10  — at module level
└  26:12 — inside closedPeriodsBalance
~~~

