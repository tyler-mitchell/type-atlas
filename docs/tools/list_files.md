<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `list_files`

Show a bounded workspace-relative project structure. `view: "files"` (the default) is the file tree rooted at the directory, directories first; `view: "directories"` is a compact directory list for architecture orientation. Rows carry `git status` inline with editor-standard letters — `· M +2 -1`, `· R old.ts →`, `· U`, `· 2 changed` on directories — so one call answers structure, reading cost, and working-tree state together; no separate git call is needed to see what changed. Results honor .gitignore, omit dependency and VCS internals, and treat Git submodules as separate workspaces by default.

## monorepo first contact

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
# answered in under 1s
```

**Response**

~~~text
ledger/
├  apps/ · 11 files
├  packages/ · 45 files
├  ledger.config.json · 10 loc
├  ledger.config.schema.json · 21 loc
├  package.json · 24 loc
├  pnpm-lock.yaml · 2.3k loc
├  pnpm-workspace.yaml · 19 loc
├  README.md · 32 loc
├  tsconfig.json · 9 loc
└  vite.config.ts · 13 loc
~~~

## every package opened

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
expand: {"packages/*":2}
# answered in under 1s
```

**Response**

~~~text
ledger/
├  apps/ · 11 files
├  packages/
│  ├  accounts/
│  │  ├  src/
│  │  │  ├  account.ts · 56 loc
│  │  │  ├  index.ts · 12 loc
│  │  │  ├  journal.ts · 73 loc
│  │  │  └  posting.ts · 32 loc
│  │  ├  tests/
│  │  │  └  journal.test.ts · 29 loc
│  │  ├  package.json · 22 loc
│  │  └  tsconfig.json · 20 loc
│  ├  importers/
│  │  ├  dist/
│  │  │  └  importers.js · 1 loc
│  │  ├  src/
│  │  │  ├  bank-profiles.ts · 42 loc
│  │  │  ├  config.ts · 7 loc
│  │  │  ├  csv.ts · 47 loc
│  │  │  ├  dedupe.ts · 18 loc
│  │  │  ├  index.ts · 7 loc
│  │  │  └  statement-parser.ts · 64 loc
│  │  ├  package.json · 23 loc
│  │  ├  tsconfig.json · 19 loc
│  │  └  vite.config.ts · 9 loc
│  ├  money/
│  │  ├  src/
│  │  │  ├  currency.ts · 19 loc
│  │  │  ├  index.ts · 12 loc
│  │  │  ├  money.ts · 58 loc
│  │  │  └  rounding-mode.ts · 15 loc
│  │  ├  tests/
│  │  │  ├  money.test.ts · 15 loc
│  │  │  └  rounding-parity.ts · 15 loc
│  │  ├  package.json · 19 loc
│  │  └  tsconfig.json · 20 loc
│  ├  reconcile/
│  │  ├  src/
│  │  │  ├  drift.ts · 22 loc
│  │  │  ├  index.ts · 4 loc
│  │  │  └  matching.ts · 24 loc
│  │  ├  package.json · 19 loc
│  │  └  tsconfig.json · 20 loc
│  ├  reports/
│  │  ├  src/
│  │  │  ├  balance.ts · 58 loc
│  │  │  ├  index.ts · 2 loc
│  │  │  └  statement.ts · 11 loc
│  │  ├  package.json · 23 loc
│  │  └  tsconfig.json · 20 loc
│  ├  rules/
│  │  ├  src/
│  │  │  ├  builtin.ts · 49 loc
│  │  │  ├  index.ts · 17 loc
│  │  │  └  rule.ts · 56 loc
│  │  ├  package.json · 23 loc
│  │  └  tsconfig.json · 19 loc
│  └  utils/
│     ├  src/
│     │  └  index.ts · 3 loc
│     ├  tests/
│     │  └  index.test.ts · 6 loc
│     ├  package.json · 40 loc
│     ├  README.md · 23 loc
│     ├  tsconfig.json · 20 loc
│     └  vite.config.ts · 17 loc
├  ledger.config.json · 10 loc
├  ledger.config.schema.json · 21 loc
├  package.json · 24 loc
├  pnpm-lock.yaml · 2.3k loc
├  pnpm-workspace.yaml · 19 loc
├  README.md · 32 loc
├  tsconfig.json · 9 loc
└  vite.config.ts · 13 loc
~~~

## one corner opened deeper

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
expand: {"packages/accounts":1,"packages/reports":{"depth":2,"glob":["**/*.ts"]}}
# answered in under 1s
```

**Response**

~~~text
ledger/
├  apps/ · 11 files
├  packages/
│  ├  accounts/
│  │  ├  src/ · 4 files
│  │  ├  tests/ · 1 file
│  │  ├  package.json · 22 loc
│  │  └  tsconfig.json · 20 loc
│  └  reports/
│     └  src/
│        ├  balance.ts · 58 loc
│        ├  index.ts · 2 loc
│        └  statement.ts · 11 loc
├  ledger.config.json · 10 loc
├  ledger.config.schema.json · 21 loc
├  package.json · 24 loc
├  pnpm-lock.yaml · 2.3k loc
├  pnpm-workspace.yaml · 19 loc
├  README.md · 32 loc
├  tsconfig.json · 9 loc
└  vite.config.ts · 13 loc
~~~

## without line counts

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
directory: packages/accounts
loc: false
# answered in under 1s
```

**Response**

~~~text
packages/accounts/
├  src/ · 4 files
├  tests/ · 1 file
├  package.json
└  tsconfig.json
~~~

## test files only

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
glob: ["**/*.test.ts"]
# answered in under 1s
```

**Response**

~~~text
ledger/
└  packages/
   ├  accounts/
   │  └  tests/
   │     └  journal.test.ts · 29 loc
   ├  money/
   │  └  tests/
   │     └  money.test.ts · 15 loc
   └  utils/
      └  tests/
         └  index.test.ts · 6 loc
~~~

## working tree changes

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
# working tree arranged: currency.ts edited · rounding.ts created · index.ts deleted
directory: packages/money
depth: 2
# answered in under 1s
```

**Response**

~~~text
packages/money/
├  src/ · 3 changed
│  ├  currency.ts · 21 loc · M +2
│  ├  index.ts · D -12
│  ├  money.ts · 58 loc
│  ├  rounding-mode.ts · 15 loc
│  └  rounding.ts · 11 loc · U
├  tests/
│  ├  money.test.ts · 15 loc
│  └  rounding-parity.ts · 15 loc
├  package.json · 19 loc
└  tsconfig.json · 20 loc
~~~

## staged and renamed

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
# working tree arranged: ofx.ts created and staged · dedupe.ts renamed to duplicate-rows.ts
directory: packages/importers
depth: 2
# answered in under 1s
```

**Response**

~~~text
packages/importers/
├  dist/
│  └  importers.js · 1 loc
├  src/ · 2 changed
│  ├  bank-profiles.ts · 42 loc
│  ├  config.ts · 7 loc
│  ├  csv.ts · 47 loc
│  ├  duplicate-rows.ts · 18 loc · R dedupe.ts →
│  ├  index.ts · 7 loc
│  ├  ofx.ts · 9 loc · A +9
│  └  statement-parser.ts · 64 loc
├  package.json · 23 loc
├  tsconfig.json · 19 loc
└  vite.config.ts · 9 loc
~~~

## merge conflict

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
# working tree arranged: merge conflict on currency.ts
directory: packages/money
depth: 2
# answered in under 1s
```

**Response**

~~~text
packages/money/
├  src/ · 1 changed
│  ├  currency.ts · 25 loc · C
│  ├  index.ts · 12 loc
│  ├  money.ts · 58 loc
│  └  rounding-mode.ts · 15 loc
├  tests/
│  ├  money.test.ts · 15 loc
│  └  rounding-parity.ts · 15 loc
├  package.json · 19 loc
└  tsconfig.json · 20 loc
~~~

## subtree on a budget

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
expand: {"packages/*":{"depth":2,"limit":6}}
# answered in under 1s
```

**Response**

~~~text
ledger/
├  apps/ · 11 files
├  packages/
│  ├  accounts/
│  │  ├  src/
│  │  │  ├  account.ts · 56 loc
│  │  │  ├  index.ts · 12 loc
│  │  │  ├  journal.ts · 73 loc
│  │  │  └  posting.ts · 32 loc
│  │  ├  tests/ · 1 file
│  │  ├  package.json · 22 loc
│  │  └  … 1 more
│  ├  importers/
│  │  ├  dist/
│  │  │  └  importers.js · 1 loc
│  │  ├  src/
│  │  │  ├  bank-profiles.ts · 42 loc
│  │  │  ├  config.ts · 7 loc
│  │  │  └  … 4 more
│  │  ├  package.json · 23 loc
│  │  └  … 2 more
│  ├  money/
│  │  ├  src/
│  │  │  ├  currency.ts · 19 loc
│  │  │  ├  index.ts · 12 loc
│  │  │  ├  money.ts · 58 loc
│  │  │  └  rounding-mode.ts · 15 loc
│  │  ├  tests/ · 2 files
│  │  ├  package.json · 19 loc
│  │  └  … 1 more
│  ├  reconcile/
│  │  ├  src/
│  │  │  ├  drift.ts · 22 loc
│  │  │  ├  index.ts · 4 loc
│  │  │  └  matching.ts · 24 loc
│  │  ├  package.json · 19 loc
│  │  └  tsconfig.json · 20 loc
│  ├  reports/
│  │  ├  src/
│  │  │  ├  balance.ts · 58 loc
│  │  │  ├  index.ts · 2 loc
│  │  │  └  statement.ts · 11 loc
│  │  ├  package.json · 23 loc
│  │  └  tsconfig.json · 20 loc
│  ├  rules/
│  │  ├  src/
│  │  │  ├  builtin.ts · 49 loc
│  │  │  ├  index.ts · 17 loc
│  │  │  └  rule.ts · 56 loc
│  │  ├  package.json · 23 loc
│  │  └  tsconfig.json · 19 loc
│  └  utils/
│     ├  src/
│     │  └  index.ts · 3 loc
│     ├  tests/
│     │  └  index.test.ts · 6 loc
│     ├  package.json · 40 loc
│     ├  README.md · 23 loc
│     └  … 2 more
├  ledger.config.json · 10 loc
├  ledger.config.schema.json · 21 loc
├  package.json · 24 loc
├  pnpm-lock.yaml · 2.3k loc
├  pnpm-workspace.yaml · 19 loc
├  README.md · 32 loc
├  tsconfig.json · 9 loc
└  vite.config.ts · 13 loc
~~~

## bounded glob elides

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
glob: ["**/*.ts"]
limit: 12
# answered in under 1s
```

**Response**

~~~text
ledger/
├  apps/
│  └  website/
│     └  src/
│        ├  counter.ts · 9 loc
│        └  main.ts · 60 loc
├  packages/
│  ├  accounts/
│  │  ├  src/
│  │  │  ├  account.ts · 56 loc
│  │  │  ├  index.ts · 12 loc
│  │  │  ├  journal.ts · 73 loc
│  │  │  └  posting.ts · 32 loc
│  │  └  tests/
│  │     └  journal.test.ts · 29 loc
│  ├  importers/
│  │  ├  src/
│  │  │  ├  bank-profiles.ts · 42 loc
│  │  │  ├  config.ts · 7 loc
│  │  │  ├  csv.ts · 47 loc
│  │  │  ├  dedupe.ts · 18 loc
│  │  │  ├  index.ts · 7 loc
│  │  │  └  … 1 more
│  │  └  … 1 more
│  ├  money/ · 6 files
│  ├  reconcile/ · 3 files
│  ├  reports/ · 3 files
│  ├  rules/ · 3 files
│  └  utils/ · 3 files
└  … 1 more
~~~

## only the delta

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
# working tree arranged: currency.ts edited · qif.ts created · index.ts deleted
changed: true
# answered in under 1s
```

**Response**

~~~text
ledger/
└  packages/ · 3 changed
   ├  importers/ · 1 changed
   │  └  src/ · 1 changed
   │     └  qif.ts · 4 loc · U
   └  money/ · 2 changed
      └  src/ · 2 changed
         ├  currency.ts · 21 loc · M +2
         └  index.ts · D -12
~~~

## delta of a clean tree

**Agent's Input**

```yaml
tool: List files
workspace: fixtures/ledger
directory: packages/accounts
changed: true
# answered in under 1s
```

**Response**

~~~text
Nothing here differs from HEAD — the working tree under this directory is clean.
~~~

