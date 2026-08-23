<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `investigate_code`

Retrieve ranked code for an implementation question and attach verified relationships to the exact identifier match or a bounded set of distinct candidates. Structural similarity is optional and remains separate.

## behavioral question lands

**Agent's Input**

```yaml
tool: Investigate code
workspace: fixtures/ledger
question: how are account balances rolled up to ancestor accounts

# answered in 33ms
```

**Response**

~~~text
Search: how are account balances rolled up to ancestor accounts

3 matches · no identifier to anchor on, so these are ranked by meaning alone

=== 1 · packages/accounts/src/account.ts:21-35 ===

Structure: parentPath
Symbol: parentPath [variable] · selection 21:14-21:24 · range 21:14-24:2

21 | export const parentPath = (path: AccountPath): AccountPath | undefined => {
22 |   const at = path.lastIndexOf(":");
23 |   return at === -1 ? undefined : path.slice(0, at);
24 | };
25 |
26 | /** Every ancestor from root to the account itself: `a`, `a:b`, `a:b:c`. */

=== 2 · packages/reports/src/balance.ts:1-23 ===

Structure: BalanceLine
Symbol: BalanceLine [interface] · selection 11:18-11:29 · range 11:1-16:2

1 | import {
2 |   type AccountPath,
3 |   type Entry,
4 |   type Journal,
5 |   lineage,
6 |   signedAmount,

=== 3 · packages/accounts/src/journal.ts:59-73 ===

Structure: Journal > history
Symbol: history [method] · selection 60:3-60:10 · range 60:3-64:4

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

## Mentions that are not calls (1 of 3 references · 1 relevant project searched)

packages/accounts/src/index.ts:5:8-5:20:  type AccountStore,

references lists all 3, with paging.
~~~

## absent concept stays absent

**Agent's Input**

```yaml
tool: Investigate code
workspace: fixtures/ledger
question: where is the retry backoff for failed network requests configured

# answered in 25ms
```

**Response**

~~~text
Search: where is the retry backoff for failed network requests configured

3 matches · no identifier to anchor on, so these are ranked by meaning alone

=== 1 · packages/importers/src/config.ts:1-7 ===

Structure: suspenseAccount
Symbol: suspenseAccount [variable] · selection 4:14-4:29 · range 4:14-4:68

1 | import ledgerConfig from "../../../ledger.config.json" with { type: "json" };
2 |
3 | /** The account unmatched statement lines land in until a bookkeeper files them. */
4 | export const suspenseAccount: string = ledgerConfig.suspenseAccount;
5 |
6 | /** The currency a bank export is assumed to use when it does not say. */

=== 2 · packages/accounts/src/account.ts:21-35 ===

Structure: parentPath
Symbol: parentPath [variable] · selection 21:14-21:24 · range 21:14-24:2

21 | export const parentPath = (path: AccountPath): AccountPath | undefined => {
22 |   const at = path.lastIndexOf(":");
23 |   return at === -1 ? undefined : path.slice(0, at);
24 | };
25 |
26 | /** Every ancestor from root to the account itself: `a`, `a:b`, `a:b:c`. */

=== 3 · packages/importers/vite.config.ts:1-9 ===

Structure: default
Symbol: default [variable] · selection 4:1-9:3

1 | // Importers ship to the bookkeeping portal as a browser bundle; the library
2 | // packages stay unbundled. Output lands in the default `dist` beside this
3 | // config, which the repository commits so the portal deploy needs no build.
4 | export default {
5 |   build: {
6 |     outDir: "dist",

None of these declares anything the question names, so no relationship expansion follows — the matches above are retrieval's nearest neighbours, not an answer. If the concept should exist here, ask again naming an identifier from it; if you are proving absence, occurrences gives the literal zero.
~~~

