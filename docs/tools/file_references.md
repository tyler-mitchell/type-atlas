<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `file_references`

Return a bounded page of module references from the TypeScript project selected by file. Set raw to return every project-scoped reference.

## who imports money

**Agent's Input**

```yaml
tool: File references
workspace: fixtures/ledger
file: packages/money/src/money.ts
# answered in under 1s
```

**Response**

~~~text
packages/money/src/money.ts · referenced from 90 places · 10 projects loaded · packages/money/tsconfig.json

1-20 of 90 places · pass offset: 20 for the rest

packages/accounts/src/journal.ts
├  1:10  — at module level
└  53:15 — inside post
packages/money/src/index.ts
├  3:3 — at module level
└  4:3 — at module level
packages/money/tests/money.test.ts
├  2:10  — at module level
├  2:15  — at module level
├  5:10  — inside test("adds amounts of one currency exactly") callback
├  9:16  — inside expect() callback
├  9:67  — inside test("refuses to combine currencies") callback
├  13:10 — inside test("formats major and minor units per currency") callback
└  14:10 — inside test("formats major and minor units per currency") callback
packages/reconcile/src/drift.ts
├  5:10  — at module level
└  21:10 — inside drift
packages/reports/src/balance.ts
├  8:10  — at module level
├  34:9  — inside balancesAsOf
└  41:28 — inside balancesAsOf
packages/reports/src/statement.ts
├  2:10  — at module level
└  10:40 — inside statementLine
packages/rules/src/builtin.ts
├  2:10  — at module level
└  28:58 — inside closedPeriodsBalance
~~~

