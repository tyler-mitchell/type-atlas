<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `read_file`

Read one or more UTF-8 text files, including source, Markdown, and JSON, with stable line numbers. Pass every path in one call rather than calling repeatedly. Function bodies fold to their signatures by default; startLine, endLine, and fold apply to every path in the call.

## class folded to signatures

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/accounts/src/journal.ts"]
```

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

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/accounts/src/posting.ts",{"path":"packages/money/src/money.ts","startLine":26,"endLine":41,"fold":false}]
```

~~~text
2 files · 43 lines · 6 folded to signatures, pass fold: false for the bodies

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

=== packages/money/src/money.ts · lines 26-41 of 52 ===

26 |
27 | export const money = (minorUnits: bigint | number, currency: Currency): Money =>
28 |   ({ minorUnits: BigInt(minorUnits), currency }) as Money;
29 |
30 | export const zero = (currency: Currency): Money => money(0n, currency);
31 |
32 | export const add = (left: Money, right: Money): Money => {
33 |   if (left.currency !== right.currency) {
34 |     throw new CurrencyMismatchError(left.currency, right.currency);
35 |   }
36 |   return money(left.minorUnits + right.minorUnits, left.currency);
37 | };
38 |
39 | export const negate = (value: Money): Money => money(-value.minorUnits, value.currency);
40 |
41 | export const isZero = (value: Money): boolean => value.minorUnits === 0n;
~~~

## abstract class folded

```yaml
tool: Read files
workspace: fixtures/ledger
file: ["packages/importers/src/statement-parser.ts"]
```

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

