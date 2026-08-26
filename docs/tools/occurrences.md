<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `occurrences`

Find exact identifiers or expressions without knowing their files. Identifier queries resolve semantic references; expression queries match AST structure and receive Volar annotations. Use search_code for meaning-based retrieval.

## semantic symbol and unresolved node

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
query: money
limit: 12

# answered in 244ms
```

**Response**

~~~text
Identifiers: "money"

Scope: workspace · 33 project files

Showing 1–12 of 22 references · next offset: 12

=== money [function] · packages/money/src/money.ts:27:14 · 12/22 references shown ===

24 exact-name locations across 8 files · 1 without a workspace declaration

Locations without a workspace declaration (1):

packages/reconcile/src/matching.ts:24:37 — inside emptyRemainder · export const emptyRemainder = () => money(0, "USD");

packages/importers/src/csv.ts
├  2:37  — at module level · import { type Currency, isCurrency, money, zero, format } from "@ledger/money";
└  34:20 — inside amount · const amount = money(Math.abs(row.amountMinor), row.currency);
packages/money/src/index.ts
└  8:3 — at module level · money,
packages/money/src/money.ts
├  30:52 — inside zero · export const zero = (currency: Currency): Money => money(0n, currency);
├  42:10 — inside add · return money(left.minorUnits + right.minorUnits, left.currency);
└  45:48 — inside negate · export const negate = (value: Money): Money => money(-value.minorUnits, value.currency);
packages/reconcile/src/drift.ts
├  5:18  — at module level · import { format, money, type Money } from "@ledger/money";
└  21:17 — inside drift · return format(money(journalTotal - statementTotal(statement), "usd"));
packages/accounts/tests/journal.test.ts
├  1:10  — at module level · import { money } from "@ledger/money";
├  9:71  — inside test("posts a balanced transfer through the overload") callback · { from: "assets:bank:checking", to: "expenses:furniture", amount: money(24900, "USD") },
├  23:34 — inside expect() callback · debit("expenses:travel", money(5000, "USD")),
└  24:40 — inside expect() callback · credit("assets:bank:checking", money(500, "USD")),
~~~

## same name symbols stay separate

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
query: value
symbolLimit: 5
limit: 12

# answered in 239ms
```

**Response**

~~~text
Identifiers: "value"

Scope: workspace · 33 project files

=== value · 4 symbols · 10 references ===

14 exact-name locations across 2 files

=== value [parameter] · isCurrency · packages/money/src/currency.ts:19:28 · 2 references ===

packages/money/src/currency.ts:19:44,65 — inside isCurrency · export const isCurrency = (value: string): value is Currency => value in currencyProfiles;

=== value [parameter] · negate · packages/money/src/money.ts:45:24 · 2 references ===

packages/money/src/money.ts:45:55,73 — inside negate · export const negate = (value: Money): Money => money(-value.minorUnits, value.currency);

=== value [parameter] · isZero · packages/money/src/money.ts:47:24 · 1 reference ===

packages/money/src/money.ts:47:50 — inside isZero · export const isZero = (value: Money): boolean => value.minorUnits === 0n;

=== value [parameter] · format · packages/money/src/money.ts:50:24 · 5 references ===

packages/money/src/money.ts
├  51:59       — inside format · const { minorUnitsPerMajor, symbol } = currencyProfiles[value.currency];
├  52:16       — inside sign · const sign = value.minorUnits < 0n ? "-" : "";
└  53:21,46,65 — inside magnitude · const magnitude = value.minorUnits < 0n ? -value.minorUnits : value.minorUnits;
~~~

## small page stays compact

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
query: value
symbolLimit: 2
limit: 1

# answered in 30ms
```

**Response**

~~~text
Identifiers: "value"

Scope: workspace · 33 project files

Showing 1–1 of 4 references · next offset: 1

=== value · 2 symbols · 4 references ===

14 exact-name locations across 2 files · 8 remain after the first 2 symbols; narrow path or raise symbolLimit

=== value [parameter] · isCurrency · packages/money/src/currency.ts:19:28 · 1/2 references shown ===

packages/money/src/currency.ts:19:44 — inside isCurrency · export const isCurrency = (value: string): value is Currency => value in currencyProfiles;
~~~

## overloads are one symbol

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
query: post
symbolLimit: 10

# answered in 271ms
```

**Response**

~~~text
Identifiers: "post"

Scope: workspace · 33 project files

=== post [method] · Journal · packages/accounts/src/journal.ts:34:3 · 3 declarations · 3 references ===

6 exact-name locations across 3 files

packages/importers/src/csv.ts
└  39:13 — inside importStatement · journal.post({
packages/accounts/tests/journal.test.ts
├  7:25  — inside test("posts a balanced transfer through the overload") callback · const entry = journal.post(
└  19:13 — inside expect() callback · journal.post({
~~~

## several symbols share one page

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
queries: ["money","signedAmount"]
symbolLimit: 5
limit: 8

# answered in 271ms
```

**Response**

~~~text
Identifiers: "money", "signedAmount"

Scope: workspace · 33 project files

Showing 1–8 of 31 references · next offset: 8

=== money [function] · packages/money/src/money.ts:27:14 · 4/22 references shown ===

24 exact-name locations across 8 files · 1 without a workspace declaration

Locations without a workspace declaration (1):

packages/reconcile/src/matching.ts:24:37 — inside emptyRemainder · export const emptyRemainder = () => money(0, "USD");

packages/importers/src/csv.ts
├  2:37  — at module level · import { type Currency, isCurrency, money, zero, format } from "@ledger/money";
└  34:20 — inside amount · const amount = money(Math.abs(row.amountMinor), row.currency);
packages/money/src/index.ts
└  8:3 — at module level · money,
packages/money/src/money.ts
└  30:52 — inside zero · export const zero = (currency: Currency): Money => money(0n, currency);

=== signedAmount [function] · packages/accounts/src/posting.ts:25:14 · 4/9 references shown ===

11 exact-name locations across 7 files · 1 without a workspace declaration

Locations without a workspace declaration (1):

packages/reconcile/src/matching.ts:14:20 — inside amount · const amount = signedAmount(posting);

packages/accounts/src/index.ts
└  12:39 — at module level · export { credit, debit, type Posting, signedAmount } from "./posting.ts";
packages/accounts/src/journal.ts
├  3:39  — at module level · import { credit, debit, type Posting, signedAmount } from "./posting.ts";
└  52:12 — inside post · .map(signedAmount)
packages/reconcile/src/drift.ts
└  4:24 — at module level · import { type Posting, signedAmount } from "@ledger/accounts";
~~~

## several scopes one call

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
query: money
paths: ["packages/money","packages/accounts"]
limit: 12

# answered in 31ms
```

**Response**

~~~text
Identifiers: "money"

Scope: packages/money + packages/accounts · 11 project files

Showing 1–12 of 18 references · next offset: 12

=== money [function] · packages/money/src/money.ts:27:14 · 12/18 references shown ===

19 exact-name locations across 5 files

packages/money/src/index.ts
└  8:3 — at module level · money,
packages/money/src/money.ts
├  30:52 — inside zero · export const zero = (currency: Currency): Money => money(0n, currency);
├  42:10 — inside add · return money(left.minorUnits + right.minorUnits, left.currency);
└  45:48 — inside negate · export const negate = (value: Money): Money => money(-value.minorUnits, value.currency);
packages/accounts/tests/journal.test.ts
├  1:10  — at module level · import { money } from "@ledger/money";
├  9:71  — inside test("posts a balanced transfer through the overload") callback · { from: "assets:bank:checking", to: "expenses:furniture", amount: money(24900, "USD") },
├  23:34 — inside expect() callback · debit("expenses:travel", money(5000, "USD")),
└  24:40 — inside expect() callback · credit("assets:bank:checking", money(500, "USD")),
packages/money/tests/money.test.ts
├  2:46    — at module level · import { add, CurrencyMismatchError, format, money, negate } from "../src/index.ts";
├  5:14,34 — inside test("adds amounts of one currency exactly") callback · expect(add(money(1050, "USD"), money(25, "USD")).minorUnits).toBe(1075n);
└  9:20    — inside expect() callback · expect(() => add(money(100, "USD"), money(100, "EUR"))).toThrow(CurrencyMismatchError);
~~~

## exact expression is structural

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
query: currencyProfiles[value.currency]

# answered in 25ms
```

**Response**

~~~text
Expression: "currencyProfiles[value.currency]"

Scope: workspace · 33 project files

=== currencyProfiles [const] · packages/money/src/currency.ts:12:14 · 1 reference ===

1 structural match across 1 file

packages/money/src/money.ts:51:42 — inside format · const { minorUnitsPerMajor, symbol } = currencyProfiles[value.currency];
~~~

## semantic absence names the source corpus

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
query: quantumFlux

# answered in 30ms
```

**Response**

~~~text
Identifiers: "quantumFlux"

Scope: workspace · 33 project files

=== quantumFlux · no exact identifier ===
~~~

## warm repeat is identical.first

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
query: value
symbolLimit: 5
limit: 12

# answered in 38ms
```

**Response**

~~~text
Identifiers: "value"

Scope: workspace · 33 project files

=== value · 4 symbols · 10 references ===

14 exact-name locations across 2 files

=== value [parameter] · isCurrency · packages/money/src/currency.ts:19:28 · 2 references ===

packages/money/src/currency.ts:19:44,65 — inside isCurrency · export const isCurrency = (value: string): value is Currency => value in currencyProfiles;

=== value [parameter] · negate · packages/money/src/money.ts:45:24 · 2 references ===

packages/money/src/money.ts:45:55,73 — inside negate · export const negate = (value: Money): Money => money(-value.minorUnits, value.currency);

=== value [parameter] · isZero · packages/money/src/money.ts:47:24 · 1 reference ===

packages/money/src/money.ts:47:50 — inside isZero · export const isZero = (value: Money): boolean => value.minorUnits === 0n;

=== value [parameter] · format · packages/money/src/money.ts:50:24 · 5 references ===

packages/money/src/money.ts
├  51:59       — inside format · const { minorUnitsPerMajor, symbol } = currencyProfiles[value.currency];
├  52:16       — inside sign · const sign = value.minorUnits < 0n ? "-" : "";
└  53:21,46,65 — inside magnitude · const magnitude = value.minorUnits < 0n ? -value.minorUnits : value.minorUnits;
~~~

## warm repeat is identical.repeat

**Agent's Input**

```yaml
tool: Occurrences
workspace: fixtures/ledger
query: value
symbolLimit: 5
limit: 12

# answered in 37ms
```

**Response**

~~~text
Identifiers: "value"

Scope: workspace · 33 project files

=== value · 4 symbols · 10 references ===

14 exact-name locations across 2 files

=== value [parameter] · isCurrency · packages/money/src/currency.ts:19:28 · 2 references ===

packages/money/src/currency.ts:19:44,65 — inside isCurrency · export const isCurrency = (value: string): value is Currency => value in currencyProfiles;

=== value [parameter] · negate · packages/money/src/money.ts:45:24 · 2 references ===

packages/money/src/money.ts:45:55,73 — inside negate · export const negate = (value: Money): Money => money(-value.minorUnits, value.currency);

=== value [parameter] · isZero · packages/money/src/money.ts:47:24 · 1 reference ===

packages/money/src/money.ts:47:50 — inside isZero · export const isZero = (value: Money): boolean => value.minorUnits === 0n;

=== value [parameter] · format · packages/money/src/money.ts:50:24 · 5 references ===

packages/money/src/money.ts
├  51:59       — inside format · const { minorUnitsPerMajor, symbol } = currencyProfiles[value.currency];
├  52:16       — inside sign · const sign = value.minorUnits < 0n ? "-" : "";
└  53:21,46,65 — inside magnitude · const magnitude = value.minorUnits < 0n ? -value.minorUnits : value.minorUnits;
~~~

