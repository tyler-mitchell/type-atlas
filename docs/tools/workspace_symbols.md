<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `workspace_symbols`

Search symbols across TypeScript projects activated in this workspace session. Potentially expensive in large monorepos: each call may search many project files, and limit only bounds returned output. Use document_symbols when the file is known; avoid parallel or repeated speculative searches.

## balance across packages

**Agent's Input**

```yaml
tool: Workspace symbols
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
query: Balance

# answered in 732ms
```

**Response**

~~~text
5 symbols matching Balance · 8 projects loaded · packages/reports/tsconfig.json

BalanceLine [interface] · packages/reports/src/balance.ts:11:1-16:2
balance [property] · packages/reports/src/balance.ts:13:3-13:27 — BalanceLine
balancesAsOf [const] · packages/reports/src/balance.ts:23:14-51:2
normalBalance [const] · packages/accounts/src/account.ts:18:14-19:62
closedPeriodsBalance [const] · packages/rules/src/builtin.ts:22:14-35:2
~~~

## case insensitive partial name

**Agent's Input**

```yaml
tool: Workspace symbols
workspace: fixtures/ledger
file: packages/accounts/src/account.ts
query: store

# answered in 53ms
```

**Response**

~~~text
2 symbols matching store · 8 projects loaded · packages/accounts/tsconfig.json

AccountStore [interface] · packages/accounts/src/account.ts:31:1-35:2
MemoryAccountStore [class] · packages/accounts/src/account.ts:37:1-56:2
~~~

## class family by suffix

**Agent's Input**

```yaml
tool: Workspace symbols
workspace: fixtures/ledger
file: packages/importers/src/statement-parser.ts
query: Parser

# answered in 100ms
```

**Response**

~~~text
3 symbols matching Parser · 8 projects loaded · packages/importers/tsconfig.json

CsvStatementParser [class] · packages/importers/src/statement-parser.ts:25:1-35:2
FixedWidthStatementParser [class] · packages/importers/src/statement-parser.ts:41:1-64:2
StatementParser [class] · packages/importers/src/statement-parser.ts:7:1-23:2
~~~

