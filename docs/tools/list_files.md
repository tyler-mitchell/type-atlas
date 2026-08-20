<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `list_files`

Show a bounded workspace-relative project structure. `view: "files"` (the default) is the file tree rooted at the directory, directories first; `view: "directories"` is a compact directory list for architecture orientation. Rows carry `git status` inline with editor-standard letters — `· M +2 -1`, `· R old.ts →`, `· U`, `· 2 changed` on directories — so one call answers structure, reading cost, and working-tree state together; no separate git call is needed to see what changed. Results honor .gitignore, omit dependency and VCS internals, and treat Git submodules as separate workspaces by default.

## monorepo first contact

```yaml
tool: List files
workspace: fixtures/ledger
```

~~~text
ledger/
├  apps/ · 11 files
├  packages/ · 42 files
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

```yaml
tool: List files
workspace: fixtures/ledger
expand: {"packages/*":2}
```

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
│  │  ├  src/
│  │  │  ├  config.ts · 7 loc
│  │  │  ├  csv.ts · 47 loc
│  │  │  ├  dedupe.ts · 18 loc
│  │  │  ├  index.ts · 7 loc
│  │  │  └  statement-parser.ts · 64 loc
│  │  ├  package.json · 23 loc
│  │  └  tsconfig.json · 19 loc
│  ├  money/
│  │  ├  src/
│  │  │  ├  currency.ts · 19 loc
│  │  │  ├  index.ts · 12 loc
│  │  │  ├  money.ts · 52 loc
│  │  │  └  rounding-mode.ts · 15 loc
│  │  ├  tests/
│  │  │  └  money.test.ts · 15 loc
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

```yaml
tool: List files
workspace: fixtures/ledger
expand: {"packages/accounts":1,"packages/reports":{"depth":2,"glob":["**/*.ts"]}}
```

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

```yaml
tool: List files
workspace: fixtures/ledger
directory: packages/accounts
loc: false
```

~~~text
packages/accounts/
├  src/ · 4 files
├  tests/ · 1 file
├  package.json
└  tsconfig.json
~~~

## test files only

```yaml
tool: List files
workspace: fixtures/ledger
glob: ["**/*.test.ts"]
```

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

```yaml
tool: List files
workspace: fixtures/ledger
directory: packages/money
depth: 2
```

~~~text
packages/money/
├  src/ · 3 changed
│  ├  currency.ts · 21 loc · M +2
│  ├  index.ts · D -12
│  ├  money.ts · 52 loc
│  ├  rounding-mode.ts · 15 loc
│  └  rounding.ts · 11 loc · U
├  tests/
│  └  money.test.ts · 15 loc
├  package.json · 19 loc
└  tsconfig.json · 20 loc
~~~

## staged and renamed

```yaml
tool: List files
workspace: fixtures/ledger
directory: packages/importers
depth: 2
```

~~~text
packages/importers/
├  src/ · 2 changed
│  ├  config.ts · 7 loc
│  ├  csv.ts · 47 loc
│  ├  duplicate-rows.ts · 18 loc · R dedupe.ts →
│  ├  index.ts · 7 loc
│  ├  ofx.ts · 9 loc · A +9
│  └  statement-parser.ts · 64 loc
├  package.json · 23 loc
└  tsconfig.json · 19 loc
~~~

## merge conflict

```yaml
tool: List files
workspace: fixtures/ledger
directory: packages/money
depth: 2
```

~~~text
packages/money/
├  src/ · 1 changed
│  ├  currency.ts · 25 loc · C
│  ├  index.ts · 12 loc
│  ├  money.ts · 52 loc
│  └  rounding-mode.ts · 15 loc
├  tests/
│  └  money.test.ts · 15 loc
├  package.json · 19 loc
└  tsconfig.json · 20 loc
~~~

