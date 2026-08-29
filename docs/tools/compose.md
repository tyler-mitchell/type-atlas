<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `compose`

Answer several questions about code in one call, laid out how you want. `{% ask %}` declares data and renders nothing; the body you write is the answer. Every ask binds `.text`, already rendered exactly as that tool renders it.

    {% ask "references" as="uses" file="src/x.ts" symbol="foo" /%}
    {% $uses.text %}

Every ask takes `as`. Positional asks take `file` and either `symbol` or one-based `line`+`character`. File and workspace asks take only the attributes shown below. Add `each=<an earlier bind, or a literal list>` to run it once per item, max 10 → { items, total, of, text }, each item also carrying `title`.

ASKS — further attributes → what it binds besides `text`

  inspect_symbol(includeSource?, includeTypeDefinitions?, limit?=20)
      → { symbol, documentation, mentions, callers, callees, implementations, typeDefinitions }
  hover()                         → { }
  subject()                       → { name, kind, file, at }
  references(tests?: "only" | "exclude", limit?=50)
      → { total, shown, beyond, any, files, paths, projects, groups }
  definitions(limit?=50)          → { total, shown, beyond, any, files, paths, hits }
  type_definitions(limit?=50)     → as definitions
  implementations(limit?=50)      → as definitions      // a zero can mean unsearched; text says which
  file_references(limit?=50)      → as references       // who imports this module
  callers()                       → { name, total, any, groups, standardLibrary, projects }   // loaded projects
  callees()                       → { name, total, any, groups, standardLibrary }   // owning project
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
  {% summary %} / {% row label value /%}  {% truncate value columns? /%}  {% pad value columns /%}

PARTIALS — pass the variable each reads as `as`

  reference-node.mdoc    $node    groups from references, file_references
  call-node.mdoc         $node    groups from callers, callees
  symbol-node.mdoc       $node    tree from document_symbols
  location-node.mdoc     $node    groups inside inspect_symbol: mentions, implementations, typeDefinitions
  target.mdoc            $target  the same groups, location only
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

## orient in a package

**Agent's Input**

```yaml
tool: Compose
workspace: fixtures/ledger
document: {% ask "list_files" as="tree" directory="packages/money" glob=["src/**/*.ts"] /%}
{% ask "document_symbols" as="shapes" each=$tree.files depth=0 /%}

# packages/money — {% $tree.total %} source files

{% $tree.text %}

# What each declares

{% $shapes.text %}

# answered in 41ms
```

**Response**

~~~text
# packages/money — 4 source files

packages/money/
└  src/
   ├  currency.ts · 19 loc
   ├  index.ts · 12 loc
   ├  money.ts · 58 loc
   └  rounding-mode.ts · 15 loc

# What each declares

## packages/money/src/currency.ts

Currency [interface] 2:13-2:21 · range 2:1-2:54
CurrencyProfile [interface] 5:18-5:33 · range 5:1-10:2
currencyProfiles [variable] 12:14-12:30 · range 12:14-17:2 · 16 entries
isCurrency [variable] 19:14-19:24 · range 19:14-19:90

## packages/money/src/index.ts

Nothing to report.

## packages/money/src/money.ts

add [variable] 38:14-38:17 · range 38:14-43:2
brand [variable] 3:15-3:20 · range 3:15-3:35
CurrencyMismatchError [class] 18:14-18:35 · range 18:1-25:2
format [variable] 50:14-50:20 · range 50:14-58:2
isZero [variable] 47:14-47:20 · range 47:14-47:73
money [variable] 27:14-27:19 · range 27:14-28:58 · 2 entries
Money [interface] 12:13-12:18 · range 12:1-16:3
negate [variable] 45:14-45:20 · range 45:14-45:88
zero [variable] 30:14-30:18 · range 30:14-30:71

## packages/money/src/rounding-mode.ts

bankRounding [variable] 9:7-9:19 · range 9:7-12:2 · 2 entries
RoundingMode [enum] 2:13-2:25 · range 2:1-6:2
roundingModeOf [variable] 14:14-14:28 · range 14:14-15:46
~~~

## inspect every candidate

**Agent's Input**

```yaml
tool: Compose
workspace: fixtures/ledger
document: {% ask "search_code" as="found" query="deciding whether a posting balances" limit=2 /%}
{% ask "inspect_symbol" as="all" each=$found.hits /%}

# {% $found.total %} of {% $found.of %} matches anchored to a declaration

{% $all.text %}

# answered in 68ms
```

**Response**

~~~text
# 2 of 2 matches anchored to a declaration

## signedAmount · packages/accounts/src/posting.ts:25

signedAmount [function] · packages/accounts/src/posting.ts:25:14-25:26 · range 25:1-32:3 · packages/accounts/tsconfig.json

```typescript
const signedAmount: (posting: Posting) => Money
```

A posting's effect on a debit-normal running balance.

## Callers (4)

post [method] packages/accounts/src/journal.ts:34:3-57:4 · calls 52:12-52:24
balancesAsOf [variable] packages/reports/src/balance.ts:23:14-23:26 · range 23:14-51:2 · calls 34:57-34:69
journalTotal [variable] packages/reconcile/src/drift.ts:20:9-20:21 · range 20:9-20:92 · calls 20:37-20:49
closedPeriodsBalance [variable] packages/rules/src/builtin.ts:22:14-22:34 · range 22:14-35:2 · calls 26:12-26:24

## Calls (1 workspace · 0 dependency/runtime)

Every call site is in packages/accounts/src/posting.ts; each row names where the callee is declared.

negate [function] packages/money/src/money.ts:45:14-45:20 · range 45:23-45:88 · calls 30:14-30:20

## Mentions that are not calls (5 of 10 references · 5 relevant projects searched)

packages/accounts/src/index.ts:12:39-12:51:  export { credit, debit, type Posting, signedAmount } from "./posting.ts";
packages/accounts/src/journal.ts:3:39-3:51:  import { credit, debit, type Posting, signedAmount } from "./posting.ts";
packages/reports/src/balance.ts:6:3-6:15:  signedAmount,
packages/reconcile/src/drift.ts:4:24-4:36:  import { type Posting, signedAmount } from "@ledger/accounts";
packages/rules/src/builtin.ts:1:10-1:22:  import { signedAmount } from "@ledger/accounts";

references lists all 10, with paging.

## BalanceLine · packages/reports/src/balance.ts:11

BalanceLine [interface] · packages/reports/src/balance.ts:11:18-11:29 · range 11:1-16:2 · packages/reports/tsconfig.json

```typescript
interface BalanceLine
```

A point-in-time balance, rolled up through the account hierarchy.

No implementation answered — the walk reaches only files this session has opened, so a declaration realising this in an untouched file reports nothing here. references lists every use, including those declarations.

## Mentions that are not calls (1 of 3 references · 1 relevant project searched)

packages/reports/src/index.ts:1:15-1:26:  export { type BalanceLine, balancesAsOf, type StatementDescription } from "./balance.ts";

references lists all 3, with paging.
~~~

