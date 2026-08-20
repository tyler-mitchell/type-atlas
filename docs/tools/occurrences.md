<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `occurrences`

Experimental: every place an exact text occurs under a directory, with an honest zero — the literal proof of absence a semantic search cannot give. Scans workspace files (gitignore honored, dependencies excluded); use it for teardown checks, string keys, config references, and "is this token ever used" questions. search_code finds meaning; this finds bytes.

## token found across packages

```yaml
tool: Occurrences
workspace: fixtures/ledger
text: signedAmount
```

~~~text
"signedAmount" occurs 12 times in 7 files · 65 files scanned under the workspace.

packages/accounts/src/index.ts:12:39 · export { credit, debit, type Posting, signedAmount } from "./posting.ts";
packages/accounts/src/journal.ts
├  3:39  · import { credit, debit, type Posting, signedAmount } from "./posting.ts";
└  52:12 · .map(signedAmount)
packages/accounts/src/posting.ts:25:14 · export const signedAmount = (posting: Posting): Money => {
packages/reconcile/src/drift.ts
├  4:24  · import { type Posting, signedAmount } from "@ledger/accounts";
└  20:37 · const journalTotal = postings.map(signedAmount).reduce((total, amount) => total + amount);
packages/reconcile/src/matching.ts
├  1:55  · // DELIBERATELY BROKEN — the imports for `money` and `signedAmount` are
└  14:20 · const amount = signedAmount(posting);
packages/reports/src/balance.ts
├  6:3   · signedAmount,
└  34:57 · add(own.get(posting.account) ?? zero(currency), signedAmount(posting)),
packages/rules/src/builtin.ts
├  1:10  · import { signedAmount } from "@ledger/accounts";
└  26:12 · .map(signedAmount)
~~~

## honest zero

```yaml
tool: Occurrences
workspace: fixtures/ledger
text: quantumFlux
```

~~~text
Nothing under the workspace contains "quantumFlux" · 65 files scanned. This is a literal answer: the exact text does not occur in what was scanned, which is the proof a semantic search cannot give.
~~~

