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
Closure of signedAmount · 7 declarations · 19 sites · depth 2

signedAmount · packages/accounts/src/posting.ts:25:14
├  imbalance · packages/accounts/src/journal.ts:51:11
│  ├  52:12 · .map(signedAmount)
│  └  post · packages/accounts/src/journal.ts:34:3 · …
│     ├  54:60 · if (!isZero(imbalance)) throw new UnbalancedEntryError(imbalance);
│     └  54:17 · if (!isZero(imbalance)) throw new UnbalancedEntryError(imbalance);
├  balancesAsOf · packages/reports/src/balance.ts:23:14
│  └  34:57 · add(own.get(posting.account) ?? zero(currency), signedAmount(posting)),
├  journalTotal · packages/reconcile/src/drift.ts:20:9
│  ├  20:37 · const journalTotal = postings.map(signedAmount).reduce((total, amount) => total + amount);
│  └  drift · packages/reconcile/src/drift.ts:19:14 · …
│     └  21:23 · return format(money(journalTotal - statementTotal(statement), "usd"));
└  closedPeriodsBalance · packages/rules/src/builtin.ts:22:14
   └  26:12 · .map(signedAmount)

2 marked … were not expanded · raise depth or limit to follow them
~~~

## three hops from money

```yaml
tool: Quorl
workspace: fixtures/ledger
file: packages/money/src/money.ts
position: {"line":27,"character":14}
depth: 3
limit: 20
```

~~~text
Closure of money · 21 declarations · 57 sites · depth 3

money · packages/money/src/money.ts:27:14
├  packages/money/tests/money.test.ts
│  ├  test("formats major and minor units per currency") callback · :12:52
│  │  ├  14:24 · expect(format(negate(money(5000, "JPY")))).toBe("-¥5000");
│  │  ├  13:17 · expect(format(money(123456, "GBP"))).toBe("£1234.56");
│  │  └  14:17 · expect(format(negate(money(5000, "JPY")))).toBe("-¥5000");
│  ├  expect() callback · :9:10
│  │  ├  9:39 · expect(() => add(money(100, "USD"), money(100, "EUR"))).toThrow(CurrencyMismatchError);
│  │  ├  9:20 · expect(() => add(money(100, "USD"), money(100, "EUR"))).toThrow(CurrencyMismatchError);
│  │  └  9:16 · expect(() => add(money(100, "USD"), money(100, "EUR"))).toThrow(CurrencyMismatchError);
│  └  test("adds amounts of one currency exactly") callback · :4:46
│     ├  5:34 · expect(add(money(1050, "USD"), money(25, "USD")).minorUnits).toBe(1075n);
│     ├  5:14 · expect(add(money(1050, "USD"), money(25, "USD")).minorUnits).toBe(1075n);
│     └  5:10 · expect(add(money(1050, "USD"), money(25, "USD")).minorUnits).toBe(1075n);
├  packages/money/src/money.ts
│  ├  negate · :39:14
│  │  ├  39:48 · export const negate = (value: Money): Money => money(-value.minorUnits, value.currency);
│  │  ├  signedAmount · packages/accounts/src/posting.ts:25:14 · …
│  │  │  └  30:14 · return negate(posting.amount);
│  │  └  shown · packages/reports/src/statement.ts:9:9 · …
│  │     └  9:60 · const shown = normalBalance(account.kind) === "credit" ? negate(balance) : balance;
│  ├  add · :32:14
│  │  ├  36:10 · return money(left.minorUnits + right.minorUnits, left.currency);
│  │  ├  imbalance · packages/accounts/src/journal.ts:51:11 · …
│  │  │  ├  53:15 · .reduce(add, zero(entry.postings[0]?.amount.currency ?? "USD"));
│  │  │  ├  53:20 · .reduce(add, zero(entry.postings[0]?.amount.currency ?? "USD"));
│  │  │  ├  53:31 · .reduce(add, zero(entry.postings[0]?.amount.currency ?? "USD"));
│  │  │  └  51:29 · const imbalance = entry.postings
│  │  ├  balancesAsOf · packages/reports/src/balance.ts:23:14 · …
│  │  │  ├  41:28 · rolled.set(ancestor, add(rolled.get(ancestor) ?? zero(currency), amount));
│  │  │  ├  34:9 · add(own.get(posting.account) ?? zero(currency), signedAmount(posting)),
│  │  │  ├  41:56 · rolled.set(ancestor, add(rolled.get(ancestor) ?? zero(currency), amount));
│  │  │  └  34:41 · add(own.get(posting.account) ?? zero(currency), signedAmount(posting)),
│  │  └  closedPeriodsBalance · packages/rules/src/builtin.ts:22:14 · …
│  │     └  28:58 · (held, amount) => (held === undefined ? amount : add(held, amount)),
│  └  zero · :30:14
│     ├  30:52 · export const zero = (currency: Currency): Money => money(0n, currency);
│     └  own · packages/reports/src/balance.ts:48:7 · …
│        └  48:32 · own: own.get(account) ?? zero(currency),
├  packages/accounts/tests/journal.test.ts
│  ├  postings · :22:7
│  │  ├  24:40 · credit("assets:bank:checking", money(500, "USD")),
│  │  ├  23:34 · debit("expenses:travel", money(5000, "USD")),
│  │  ├  test("posts a balanced transfer through the overload") callback · packages/accounts/tests/journal.test.ts:5:56 · …
│  │  │  └  12:16 · expect(entry.postings).toHaveLength(2);
│  │  └  packages/accounts/src/journal.ts
│  │     ├  entries.filter() callback · :61:32 · …
│  │     │  └  62:13 · entry.postings.some((posting) => posting.account === account),
│  │     ├  postings · :44:13 · …
│  │     └  postings · :9:12 · …
│  └  amount · :9:63 · …
│     └  9:71 · { from: "assets:bank:checking", to: "expenses:furniture", amount: money(24900, "USD") },
├  drift · packages/reconcile/src/drift.ts:19:14 · …
│  └  21:17 · return format(money(journalTotal - statementTotal(statement), "usd"));
└  amount · packages/importers/src/csv.ts:34:11 · …
   └  34:20 · const amount = money(Math.abs(row.amountMinor), row.currency);

13 marked … were not expanded · raise depth or limit to follow them
~~~

## pattern matcher closure

```yaml
tool: Quorl
workspace: fixtures/ledger
file: packages/rules/src/rule.ts
position: {"line":37,"character":14}
depth: 2
```

~~~text
Closure of matches · 2 declarations · 6 sites · depth 2

matches · packages/rules/src/rule.ts:37:14
└  noDirectBranchPostings · packages/rules/src/builtin.ts:14:14
   └  17:5 · matches(branch, posting.account) && !posting.account.includes(":")

0 marked … were not expanded · raise depth or limit to follow them
~~~

