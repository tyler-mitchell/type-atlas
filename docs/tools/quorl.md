<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `quorl`

Expand the transitive reference closure of a symbol, breadth-first, reporting every site with its source line and the declaration enclosing it, plus the frontier that was not expanded. Use before removing or replacing something, when you need the whole blast radius rather than one hop.

## two hops from signed amount

```yaml
tool: Quorl
workspace: fixtures/ledger
file: packages/accounts/src/posting.ts
position: {"line":25,"character":14}
depth: 2
```

~~~text
Closure of signedAmount · 6 declarations · 15 sites · depth 2

signedAmount · packages/accounts/src/posting.ts:25:14
├  imbalance · packages/accounts/src/journal.ts:51:11
│  ├  52:12 · .map(signedAmount)
│  └  post · packages/accounts/src/journal.ts:34:3 · …
│     ├  54:60 · if (!isZero(imbalance)) throw new UnbalancedEntryError(imbalance);
│     └  54:17 · if (!isZero(imbalance)) throw new UnbalancedEntryError(imbalance);
├  journalTotal · packages/reconcile/src/drift.ts:20:9
│  ├  20:37 · const journalTotal = postings.map(signedAmount).reduce((total, amount) => total + amount);
│  └  drift · packages/reconcile/src/drift.ts:19:14 · …
│     └  21:23 · return format(money(journalTotal - statementTotal(statement), "usd"));
└  balancesAsOf · packages/reports/src/balance.ts:23:14
   └  34:57 · add(own.get(posting.account) ?? zero(currency), signedAmount(posting)),

2 marked … were not expanded · raise depth or limit to follow them
~~~

