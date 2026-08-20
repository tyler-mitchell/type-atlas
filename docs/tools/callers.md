<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `callers`

Show which functions call the callable symbol at a position, grouped by caller with exact call sites. Use this instead of references when tracing incoming execution flow.

## who calls signed amount

```yaml
tool: Callers
workspace: fixtures/ledger
file: packages/accounts/src/posting.ts
position: {"line":25,"character":14}
```

~~~text
signedAmount · called from 3 places · 4 projects loaded

packages/accounts/src/journal.ts
└  post [method] 34:3-57:4 · calls 52:12-52:24
packages/reconcile/src/drift.ts
└  journalTotal [variable] 20:9-20:21 · range 20:9-20:92 · calls 20:37-20:49
packages/reports/src/balance.ts
└  balancesAsOf [variable] 23:14-23:26 · range 23:14-51:2 · calls 34:57-34:69
~~~

