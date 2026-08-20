<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `callers`

Show which functions call the callable symbol at a position, across every project loaded this session, grouped by caller with exact call sites. Use this instead of references when tracing incoming execution flow.

## who calls signed amount

```yaml
tool: Callers
workspace: fixtures/ledger
file: packages/accounts/src/posting.ts
position: {"line":25,"character":14}
```

~~~text
signedAmount · called from 4 places · 9 projects loaded

packages/accounts/src/journal.ts
└  post [method] 34:3-57:4 · calls 52:12-52:24
packages/reports/src/balance.ts
└  balancesAsOf [variable] 23:14-23:26 · range 23:14-51:2 · calls 34:57-34:69
packages/reconcile/src/drift.ts
└  journalTotal [variable] 20:9-20:21 · range 20:9-20:92 · calls 20:37-20:49
packages/rules/src/builtin.ts
└  closedPeriodsBalance [variable] 22:14-22:34 · range 22:14-35:2 · calls 26:12-26:24
~~~

## who calls an overloaded method

```yaml
tool: Callers
workspace: fixtures/ledger
file: packages/accounts/src/journal.ts
position: {"line":28,"character":3}
```

~~~text
post · called from 3 places · 9 projects loaded

packages/accounts/tests/journal.test.ts
├  expect() callback [function] 18:10-27:7 · calls 19:13-19:17
└  test("posts a balanced transfer through the overload") callback [function] 5:56-14:2 · calls 7:25-7:29
packages/importers/src/csv.ts
└  importStatement [variable] 28:14-28:29 · range 28:14-47:2 · calls 39:13-39:17
~~~

