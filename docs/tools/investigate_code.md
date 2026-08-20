<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `investigate_code`

Retrieve ranked code for an implementation question and attach verified relationships to the exact identifier match or a bounded set of distinct candidates. Structural similarity is optional and remains separate.

## behavioral question lands

```yaml
tool: Investigate code
workspace: fixtures/ledger
question: how are account balances rolled up to ancestor accounts
```

~~~text
Search: how are account balances rolled up to ancestor accounts

3 matches · relevance is relative to the strongest match · no identifier to anchor on, so these are ranked by meaning alone

=== 1 · packages/accounts/src/account.ts:21-35 · relevance 100% ===

Structure: AccountStore
Symbol: AccountStore [interface] · selection 31:18-31:30 · range 31:1-35:2

21 | export const parentPath = (path: AccountPath): AccountPath | undefined => {
22 |   const at = path.lastIndexOf(":");
23 |   return at === -1 ? undefined : path.slice(0, at);
24 | };
25 |
26 | /** Every ancestor from root to the account itself: `a`, `a:b`, `a:b:c`. */

=== 2 · packages/reports/src/balance.ts:1-23 · relevance 86% ===

Structure: BalanceLine
Symbol: BalanceLine [interface] · selection 11:18-11:29 · range 11:1-16:2

1 | import {
2 |   type AccountPath,
3 |   type Entry,
4 |   type Journal,
5 |   lineage,
6 |   signedAmount,

=== 3 · packages/accounts/src/journal.ts:59-73 · relevance 64% ===

Structure: Journal
Symbol: Journal [class] · selection 24:14-24:21 · range 24:1-73:2

59 |   /** Entries touching an account, oldest first. */
60 |   history(account: AccountPath): readonly Entry<TMeta>[] {
61 |     return this.entries.filter((entry) =>
62 |       entry.postings.some((posting) => posting.account === account),
63 |     );
64 |   }

Verified relationships for structurally connected retrieved candidate 1

AccountStore [interface] · packages/accounts/src/account.ts:31:18-31:30 · range 31:1-35:2 · packages/accounts/tsconfig.json

```typescript
interface AccountStore
```

Where accounts live and how they are found. Implemented by `MemoryAccountStore`.

No implementation answered — the walk reaches only files this session has opened, so a declaration realising this in an untouched file reports nothing here. references lists every use, including those declarations.

## Mentions that are not calls (1 of 3 references · 1 project loaded)

packages/accounts/src/index.ts:5:8-5:20:  type AccountStore,

references lists all 3, with paging.
~~~

## absent concept stays absent

```yaml
tool: Investigate code
workspace: fixtures/ledger
question: where is the retry backoff for failed network requests configured
```

~~~text
Search: where is the retry backoff for failed network requests configured

3 matches · relevance is relative to the strongest match · no identifier to anchor on, so these are ranked by meaning alone

=== 1 · packages/importers/src/config.ts:1-7 · relevance 100% ===

Structure: defaultCurrencyCode
Symbol: defaultCurrencyCode [variable] · selection 7:14-7:33 · range 7:14-7:72

1 | import ledgerConfig from "../../../ledger.config.json" with { type: "json" };
2 |
3 | /** The account unmatched statement lines land in until a bookkeeper files them. */
4 | export const suspenseAccount: string = ledgerConfig.suspenseAccount;
5 |
6 | /** The currency a bank export is assumed to use when it does not say. */

=== 2 · packages/accounts/src/account.ts:21-35 · relevance 92% ===

Structure: AccountStore
Symbol: AccountStore [interface] · selection 31:18-31:30 · range 31:1-35:2

21 | export const parentPath = (path: AccountPath): AccountPath | undefined => {
22 |   const at = path.lastIndexOf(":");
23 |   return at === -1 ? undefined : path.slice(0, at);
24 | };
25 |
26 | /** Every ancestor from root to the account itself: `a`, `a:b`, `a:b:c`. */

=== 3 · packages/rules/src/builtin.ts:1-13 · relevance 84% ===

Structure: noFutureEntries
Symbol: noFutureEntries [variable] · selection 6:14-6:29 · range 6:14-11:24

1 | import { signedAmount } from "@ledger/accounts";
2 | import { add, isZero, zero, type Money } from "@ledger/money";
3 | import { matches, type AccountPattern, type RuleHandler } from "./rule.ts";
4 |
5 | /** Entries dated in the future are drafts, not records. */
6 | export const noFutureEntries =

Verified relationships for structurally connected retrieved candidate 1

defaultCurrencyCode [variable] · packages/importers/src/config.ts:7:14-7:33 · range 7:1-7:73 · packages/importers/tsconfig.json

```typescript
const defaultCurrencyCode: string
```

The currency a bank export is assumed to use when it does not say.
~~~

