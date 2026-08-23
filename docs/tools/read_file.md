<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `read_file`

Read one or more UTF-8 text files, including source, Markdown, and JSON, with stable line numbers. Pass every path in one call rather than calling repeatedly. Function bodies fold to their signatures by default; startLine, endLine, and fold apply to every path in the call.

## class folded to signatures

**Agent's Input**

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/accounts/src/journal.ts"]

# answered in 21ms
```

**Response**

~~~text
1 file · 52 lines · 22 folded to signatures, pass fold: false for the bodies

=== packages/accounts/src/journal.ts · 73 lines ===

 1 | import { add, isZero, type Money, zero } from "@ledger/money";
 2 | import type { AccountPath } from "./account.ts";
 3 | import { credit, debit, type Posting, signedAmount } from "./posting.ts";
 4 |
 5 | /** A balanced set of postings, recorded together or not at all. */
 6 | export interface Entry<TMeta = undefined> {
 7 |   readonly recordedAt: Date;
 8 |   readonly description: string;
 9 |   readonly postings: readonly Posting[];
10 |   readonly meta: TMeta;
11 | }
12 |
13 | export class UnbalancedEntryError extends Error {
14 |   constructor(readonly imbalance: Money) {
15 |     super(`Entry does not balance: off by ${imbalance.minorUnits} minor units`);
16 |   }
17 | }
18 |
19 | /**
20 |  * An append-only journal of balanced entries. `TMeta` carries whatever a
21 |  * consumer attaches to each entry — an import batch id, an approval trail —
22 |  * without the journal knowing its shape.
23 |  */
24 | export class Journal<TMeta = undefined> {
25 |   private readonly entries: Entry<TMeta>[] = [];
26 |
27 |   /** Record a prepared entry, or build the common two-posting transfer. */
28 |   post(entry: Entry<TMeta>): Entry<TMeta>;
29 |   post(
30 |     description: string,
31 |     transfer: { from: AccountPath; to: AccountPath; amount: Money },
32 |     meta: TMeta,
33 |   ): Entry<TMeta>;
34 |   post(
   |     ... 35-56 folded
57 |   }
58 |
59 |   /** Entries touching an account, oldest first. */
60 |   history(account: AccountPath): readonly Entry<TMeta>[] {
61 |     return this.entries.filter((entry) =>
62 |       entry.postings.some((posting) => posting.account === account),
63 |     );
64 |   }
65 |
66 |   get length(): number {
67 |     return this.entries.length;
68 |   }
69 |
70 |   [Symbol.iterator](): Iterator<Entry<TMeta>> {
71 |     return this.entries[Symbol.iterator]();
72 |   }
73 | }
~~~

## two files one call

**Agent's Input**

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/accounts/src/posting.ts","packages/money/src/rounding-mode.ts"]

# answered in 7ms
```

**Response**

~~~text
2 files · 42 lines · 6 folded to signatures, pass fold: false for the bodies

=== packages/accounts/src/posting.ts · 32 lines ===

 1 | import { type Money, negate } from "@ledger/money";
 2 | import type { AccountPath } from "./account.ts";
 3 |
 4 | /**
 5 |  * One side of a journal entry. The discriminant is the bookkeeping side, so
 6 |  * every consumer's switch is checked for exhaustiveness by the compiler.
 7 |  */
 8 | export type Posting =
 9 |   | { readonly side: "debit"; readonly account: AccountPath; readonly amount: Money }
10 |   | { readonly side: "credit"; readonly account: AccountPath; readonly amount: Money };
11 |
12 | export const debit = (account: AccountPath, amount: Money): Posting => ({
13 |   side: "debit",
14 |   account,
15 |   amount,
16 | });
17 |
18 | export const credit = (account: AccountPath, amount: Money): Posting => ({
19 |   side: "credit",
20 |   account,
21 |   amount,
22 | });
23 |
24 | /** A posting's effect on a debit-normal running balance. */
25 | export const signedAmount = (posting: Posting): Money => {
   |   ... 26-31 folded
32 | };

=== packages/money/src/rounding-mode.ts · 15 lines ===

 1 | /** How sub-minor precision resolves when a statement and the books disagree. */
 2 | export enum RoundingMode {
 3 |   HalfUp = "half-up",
 4 |   HalfEven = "half-even",
 5 |   Truncate = "truncate",
 6 | }
 7 |
 8 | /** Per-institution conventions, as observed in their exports. */
 9 | const bankRounding: Readonly<Record<string, RoundingMode>> = {
10 |   "first-national": RoundingMode.HalfEven,
11 |   "harbor-credit": RoundingMode.HalfUp,
12 | };
13 |
14 | export const roundingModeOf = (bank: string): RoundingMode =>
15 |   bankRounding[bank] ?? RoundingMode.HalfEven;
~~~

## abstract class folded

**Agent's Input**

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/importers/src/statement-parser.ts"]

# answered in 8ms
```

**Response**

~~~text
1 file · 34 lines · 33 folded to signatures, pass fold: false for the bodies

=== packages/importers/src/statement-parser.ts · 64 lines ===

 1 | import { parseStatement, type StatementRow } from "./csv.ts";
 2 |
 3 | /**
 4 |  * One bank format, parsed. Concrete parsers own the format quirks; consumers
 5 |  * hold the abstraction and pick a parser by the file they were handed.
 6 |  */
 7 | export abstract class StatementParser {
   |   ... 8-22 folded
23 | }
24 |
25 | export class CsvStatementParser extends StatementParser {
   |   ... 26-34 folded
35 | }
36 |
37 | /**
38 |  * The fixed-width export some banks still produce: columns at fixed offsets,
39 |  * no header, one currency for the whole file.
40 |  */
41 | export class FixedWidthStatementParser extends StatementParser {
42 |   readonly format = "fixed-width";
43 |
44 |   constructor(private readonly currency: StatementRow["currency"]) {
45 |     super();
46 |   }
47 |
48 |   recognises(source: string): boolean {
49 |     const [first] = source.split("\n");
50 |     return first !== undefined && first.length === 42 && !first.includes(",");
51 |   }
52 |
53 |   parse(source: string): readonly StatementRow[] {
   |     ... 54-62 folded
63 |   }
64 | }
~~~

## ambient diagnostics appear once.first

**Agent's Input**

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/reconcile/src/drift.ts"]

# answered in 121ms
```

**Response**

~~~text
1 file · 22 lines

=== packages/reconcile/src/drift.ts · 22 lines ===

 1 | // DELIBERATELY BROKEN — this file exists so diagnostics scenarios capture
 2 | // real compiler errors from realistic mistakes. Do not fix; see the fixture
 3 | // README.
 4 | import { type Posting, signedAmount } from "@ledger/accounts";
 5 | import { format, money, type Money } from "@ledger/money";
 6 |
 7 | /** A bank statement line to reconcile against the journal. */
 8 | export interface StatementLine {
 9 |   readonly postedAt: Date;
10 |   readonly amount: Money;
11 |   readonly memo: string;
12 | }
13 |
14 | /** Statement total, computed by someone who forgot Money is not a number. */
15 | export const statementTotal = (lines: readonly StatementLine[]): number =>
16 |   lines.reduce((total, line) => total + line.amount, 0);
17 |
18 | /** Drift between the journal's view and the bank's view of one day. */
19 | export const drift = (postings: readonly Posting[], statement: readonly StatementLine[]) => {
20 |   const journalTotal = postings.map(signedAmount).reduce((total, amount) => total + amount);
21 |   return format(money(journalTotal - statementTotal(statement), "usd"));
22 | };

=== packages/reconcile/src/drift.ts ===

error ts(2345) 21:65-21:70 — inside drift
  Argument of type '"usd"' is not assignable to parameter of type 'Currency'.

4 problems in packages/reconcile/src/drift.ts · 3 more not shown · includeDiagnostics: verbose shows all
~~~

## broken file shows all diagnostics

**Agent's Input**

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/reconcile/src/drift.ts"]
includeDiagnostics: verbose

# answered in 8ms
```

**Response**

~~~text
1 file · 22 lines

=== packages/reconcile/src/drift.ts · 22 lines ===

 1 | // DELIBERATELY BROKEN — this file exists so diagnostics scenarios capture
 2 | // real compiler errors from realistic mistakes. Do not fix; see the fixture
 3 | // README.
 4 | import { type Posting, signedAmount } from "@ledger/accounts";
 5 | import { format, money, type Money } from "@ledger/money";
 6 |
 7 | /** A bank statement line to reconcile against the journal. */
 8 | export interface StatementLine {
 9 |   readonly postedAt: Date;
10 |   readonly amount: Money;
11 |   readonly memo: string;
12 | }
13 |
14 | /** Statement total, computed by someone who forgot Money is not a number. */
15 | export const statementTotal = (lines: readonly StatementLine[]): number =>
16 |   lines.reduce((total, line) => total + line.amount, 0);
17 |
18 | /** Drift between the journal's view and the bank's view of one day. */
19 | export const drift = (postings: readonly Posting[], statement: readonly StatementLine[]) => {
20 |   const journalTotal = postings.map(signedAmount).reduce((total, amount) => total + amount);
21 |   return format(money(journalTotal - statementTotal(statement), "usd"));
22 | };

=== packages/reconcile/src/drift.ts ===

error ts(2345) 21:65-21:70 — inside drift
  Argument of type '"usd"' is not assignable to parameter of type 'Currency'.

error ts(2362) 21:23-21:35 — inside drift
  The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.

error ts(2365) 20:77-20:91 — inside reduce() callback
  Operator '+' cannot be applied to types 'import("packages/money/src/money").Money' and 'import("packages/money/src/money").Money'.

error ts(2365) 16:33-16:52 — inside lines.reduce() callback
  Operator '+' cannot be applied to types 'number' and 'Money'.

4 problems in packages/reconcile/src/drift.ts
~~~

## missing imports diagnosed.repeat

**Agent's Input**

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/reconcile/src/matching.ts"]

# answered in 8ms
```

**Response**

~~~text
1 file · 13 lines · 12 folded to signatures, pass fold: false for the bodies

=== packages/reconcile/src/matching.ts · 24 lines ===

 1 | // DELIBERATELY BROKEN — the imports for `money` and `signedAmount` are
 2 | // missing, so `add_missing_imports` scenarios have real work to do. Do not
 3 | // fix; see the fixture README.
 4 | import type { Posting } from "@ledger/accounts";
 5 | import type { StatementLine } from "./drift.ts";
 6 |
 7 | /** Pair journal postings with the statement lines they explain. */
 8 | export const matchPostings = (
   |   ... 9-20 folded
21 | };
22 |
23 | /** The zero of a matching pass, for currencies the statement never names. */
24 | export const emptyRemainder = () => money(0, "USD");
~~~

