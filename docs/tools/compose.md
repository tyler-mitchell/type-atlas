<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `compose`

Answer several questions about code in one call, laid out how you want. `{% ask %}` declares data and renders nothing; the body you write is the answer. Every ask binds `.text`, already rendered exactly as that tool renders it.

    {% ask "references" as="uses" file="src/x.ts" symbol="foo" /%}
    {% $uses.text %}

Every ask takes `as` (required), `file`, and either `symbol` or `line`+`character` (one-based). Add `each=<an earlier bind>` to run it once per item, max 10 → { items, total, of, text }, each item also carrying `title`.

ASKS — further attributes → what it binds besides `text`

  inspect_symbol(includeSource?, includeTypeDefinitions?, limit?=20)
      → { symbol, documentation, mentions, callers, callees, implementations, typeDefinitions }
  hover()                         → { }
  subject()                       → { name, kind, file, at }
  references(tests?: "only" | "exclude", limit?=50)
      → { total, shown, beyond, any, files, paths, projects, groups }
  definitions(limit?=50)          → { total, any, files, paths, hits }
  type_definitions(limit?=50)     → as definitions
  implementations(limit?=50)      → as definitions      // a zero can mean unsearched; text says which
  file_references(limit?=50)      → as references       // who imports this module
  callers() | callees()           → { name, total, any, groups, standardLibrary }   // project-scoped
  document_symbols(depth?, raw?)  → { total, tree }
  diagnostics(files?: (path | place)[] <= 5)  → { total, any, checked, of, groups }
  read_file(from?, to?)           → { lines, startLine }
  list_files(directory?, glob?: string[], depth?, limit?=500, changed?)  → { files, total, any }
  search_code(query, directory?, limit?=5, snippetLines?=10)
      → { hits, of, total, any, file, line, character }
  occurrences(query, path?, limit?=20, symbolLimit?=5)  → { subjects, total, any }
  workspace_symbols(query, limit?=20)
      → { hits, answered, projects, total, shown, any, file, line, character }   // loaded projects only

  place = { file, line, character }. `hits` and `subjects` are places, `paths` are strings; both chain into a later ask, and `file`/`line`/`character` point at the first hit.

TAGS

  {% tree entries partial? as?="node" /%}   {% each items as partial tight? /%}   {% sections items level? /%}
  {% source lines startLine? from? to? /%}  {% section title level? %}  {% tight %}  {% indent by? %}
  {% table rows columns /%}  {% banner %}  {% divider text? /%}  {% frame source line character /%}
  {% summary %} / {% row label value /%}  {% truncate value /%}  {% pad value columns /%}
  {% plural count forms /%}  {% label name /%}  {% counts states /%}  {% severity value /%}

PARTIALS — pass the variable each reads as `as`

  reference-node.mdoc    $node    groups from references, definitions, file_references
  call-node.mdoc         $node    groups from callers, callees
  symbol-node.mdoc       $node    tree from document_symbols
  location-node.mdoc     $node
  target.mdoc            $target
  workspace-symbol.mdoc  $item    hits from workspace_symbols
  diagnostic-group.mdoc  $group   groups from diagnostics

FUNCTIONS

  any() position() range() symbolKind() list() fraction() markup() breadcrumb() figure() article() slash() time() width()

NOTES

  {% if %} sits on its own line, and guards on `any`, never `total` — a count renders on zero.
  Consecutive lines fold into one paragraph; blank-line them apart, and {% tight %} closes the gap again.
  `paths` and `files` are lists to hand on, not text to print.
  Place asks list at most `limit` and say what they cut.
  Asks run in document order and may read earlier binds. A failed ask is named below the answer; the rest still render.

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

