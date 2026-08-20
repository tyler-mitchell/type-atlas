<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `diagnostics`

Report diagnostics for the TypeScript projects you have touched — the compiler's own whole-program check, run once per project.

## deliberately broken reconcile

```yaml
tool: Diagnostics
workspace: fixtures/ledger
file: packages/reconcile/src/drift.ts
```

~~~text
packages/reconcile/src/drift.ts · 4 problems · packages/reconcile/tsconfig.json

=== packages/reconcile/src/drift.ts ===

error ts(2365) 16:33-16:52 — inside lines.reduce() callback
  Operator '+' cannot be applied to types 'number' and 'Money'.
   14 | /** Statement total, computed by someone who forgot Money is not a number.…
   15 | export const statementTotal = (lines: readonly StatementLine[]): number =>
   16 |   lines.reduce((total, line) => total + line.amount, 0);
      |                                 ^^^^^^^^^^^^^^^^^^^
   17 |
   18 | /** Drift between the journal's view and the bank's view of one day. */

error ts(2365) 20:77-20:91 — inside reduce() callback
  Operator '+' cannot be applied to types 'import("packages/money/src/money").Money' and 'import("packages/money/src/money").Money'.
   18 | /** Drift between the journal's view and the bank's view of one day. */
   19 | export const drift = (postings: readonly Posting[], statement: readonly St…
   20 |   const journalTotal = postings.map(signedAmount).reduce((total, amount) =…
      |                                                                             ^^^^^^^^^^^^^^
   21 |   return format(money(journalTotal - statementTotal(statement), "usd"));
   22 | };

error ts(2345) 21:65-21:70 — inside drift
  Argument of type '"usd"' is not assignable to parameter of type 'Currency'.
   19 | export const drift = (postings: readonly Posting[], statement: readonly St…
   20 |   const journalTotal = postings.map(signedAmount).reduce((total, amount) =…
   21 |   return format(money(journalTotal - statementTotal(statement), "usd"));
      |                                                                 ^^^^^
   22 | };
   23 |

error ts(2362) 21:23-21:35 — inside drift
  The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.
   19 | export const drift = (postings: readonly Posting[], statement: readonly St…
   20 |   const journalTotal = postings.map(signedAmount).reduce((total, amount) =…
   21 |   return format(money(journalTotal - statementTotal(statement), "usd"));
      |                       ^^^^^^^^^^^^
   22 | };
   23 |
~~~

## clean file

```yaml
tool: Diagnostics
workspace: fixtures/ledger
file: packages/money/src/money.ts
```

~~~text
No diagnostic of any severity in packages/money/src/money.ts · packages/money/tsconfig.json.
~~~

## missing imports diagnosed

```yaml
tool: Diagnostics
workspace: fixtures/ledger
file: packages/reconcile/src/matching.ts
```

~~~text
packages/reconcile/src/matching.ts · 2 problems · packages/reconcile/tsconfig.json

=== packages/reconcile/src/matching.ts ===

error ts(2304) 14:20-14:32 — inside amount
  Cannot find name 'signedAmount'.
   12 |   const matched = new Map<Posting, StatementLine>();
   13 |   for (const posting of postings) {
   14 |     const amount = signedAmount(posting);
      |                    ^^^^^^^^^^^^
   15 |     const line = lines.find(
   16 |       (candidate) => candidate.amount.minorUnits === amount.minorUnits,

error ts(2304) 24:37-24:42 — inside emptyRemainder
  Cannot find name 'money'.
   22 |
   23 | /** The zero of a matching pass, for currencies the statement never names.…
   24 | export const emptyRemainder = () => money(0, "USD");
      |                                     ^^^^^
   25 |
~~~

