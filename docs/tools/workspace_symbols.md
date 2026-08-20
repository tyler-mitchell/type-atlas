<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `workspace_symbols`

Search symbols across TypeScript projects activated in this workspace session. Potentially expensive in large monorepos: each call may search many project files, and limit only bounds returned output. Use document_symbols when the file is known; avoid parallel or repeated speculative searches.

## balance across packages

```yaml
tool: Workspace symbols
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
query: Balance
```

~~~text
4 symbols matching Balance · 4 projects loaded · packages/reports/tsconfig.json

BalanceLine [interface] · packages/reports/src/balance.ts:11:1-16:2
balance [property] · packages/reports/src/balance.ts:13:3-13:27 — BalanceLine
balancesAsOf [const] · packages/reports/src/balance.ts:23:14-51:2
normalBalance [const] · packages/accounts/src/account.ts:18:14-19:62
~~~

