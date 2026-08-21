<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `inspect_symbol`

Return a bounded working view of a symbol: type and documentation, exact definition/body ranges, distinct implementations and types, callers, direct calls, remaining references, project scope, and optional source. Select by exact file-local symbol name or source position.

## journal class

**Agent's Input**

```yaml
tool: Inspect symbol
workspace: fixtures/ledger
file: packages/accounts/src/journal.ts
symbol: Journal
# answered in 62ms
```

**Response**

~~~text
Journal [class] · packages/accounts/src/journal.ts:24:14-24:21 · range 24:1-73:2 · packages/accounts/tsconfig.json

```typescript
class Journal<TMeta = undefined>
```

An append-only journal of balanced entries. `TMeta` carries whatever a
consumer attaches to each entry — an import batch id, an approval trail —
without the journal knowing its shape.

## Callers (4)

packages/accounts/tests/journal.test.ts
├  test("posts a balanced transfer through the overload") callback [function] 5:56-14:2 · calls 6:23-6:30
└  test("refuses an unbalanced entry") callback [function] 16:37-29:2 · calls 17:23-17:30
packages/reports/src/balance.ts
└  balancesAsOf [variable] 23:14-23:26 · range 23:14-51:2 · calls 24:12-24:19
packages/importers/src/csv.ts
└  importStatement [variable] 28:14-28:29 · range 28:14-47:2 · calls 29:12-29:19

## Mentions that are not calls (4 of 9 references · 9 projects loaded)

packages/accounts/tests/journal.test.ts:3:25-3:32:  import { credit, debit, Journal, UnbalancedEntryError } from "../src/index.ts";
packages/accounts/src/index.ts:11:22-11:29:  export { type Entry, Journal, UnbalancedEntryError } from "./journal.ts";
packages/reports/src/balance.ts:4:8-4:15:  type Journal,
packages/importers/src/csv.ts:1:10-1:17:  import { Journal, type Entry, credit, debit, type AccountPath } from "@ledger/accounts";

references lists all 9, with paging.
~~~

## money type

**Agent's Input**

```yaml
tool: Inspect symbol
workspace: fixtures/ledger
file: packages/money/src/money.ts
symbol: Money
# answered in 92ms
```

**Response**

~~~text
Money [interface] · packages/money/src/money.ts:12:13-12:18 · range 12:1-16:3 · packages/money/tsconfig.json

```typescript
type Money = { readonly minorUnits: bigint; readonly currency: Currency; readonly [brand]: "Money"; }
```

An exact amount of one currency, held in minor units (cents, pence, yen).

The brand keeps a raw `{ amount, currency }` literal out of ledger math:
every `Money` passed through the system was constructed by `money()` and is
therefore integral and currency-tagged.

## Mentions that are not calls (8 of 38 references · 9 projects loaded)

packages/money/tests/rounding-parity.ts:1:15-1:20:  import { type Money, money } from "@ledger/money";
packages/money/src/index.ts:7:8-7:13:  type Money,
packages/accounts/src/journal.ts:1:28-1:33:  import { add, isZero, type Money, zero } from "@ledger/money";
packages/accounts/src/posting.ts:1:15-1:20:  import { type Money, negate } from "@ledger/money";
packages/reports/src/statement.ts:2:23-2:28:  import { format, type Money, negate } from "@ledger/money";
packages/reports/src/balance.ts:8:35-8:40:  import { add, type Currency, type Money, zero } from "@ledger/money";
packages/reconcile/src/drift.ts:5:30-5:35:  import { format, money, type Money } from "@ledger/money";
packages/rules/src/builtin.ts:2:34-2:39:  import { add, isZero, zero, type Money } from "@ledger/money";

references lists all 38, with paging.
~~~

