<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `rename_symbol`

Return a Codex patch for a TypeScript-project symbol rename at a source position. The MCP does not modify files.

## rename across packages

**Agent's Input**

```yaml
tool: Rename symbol
workspace: fixtures/ledger
file: packages/accounts/src/account.ts
position: {"line":18,"character":14}
newName: balanceSide

# answered in 8ms
```

**Response**

~~~text
Rename to balanceSide · resolved normalBalance · packages/accounts/src/account.ts:18:14 · Scope: project only · packages/accounts/tsconfig.json · 2 files · 2 edits

*** Begin Patch
*** Update File: packages/accounts/src/account.ts
@@
   readonly closedAt?: Date;
 }
 
-export const normalBalance = (kind: AccountKind): "debit" | "credit" =>
+export const balanceSide = (kind: AccountKind): "debit" | "credit" =>
   kind === "asset" || kind === "expense" ? "debit" : "credit";
 
 export const parentPath = (path: AccountPath): AccountPath | undefined => {
*** Update File: packages/accounts/src/index.ts
@@
   type AccountStore,
   lineage,
   MemoryAccountStore,
-  normalBalance,
+  balanceSide as normalBalance,
   parentPath,
 } from "./account.ts";
 export { type Entry, Journal, UnbalancedEntryError } from "./journal.ts";
*** End Patch
~~~

## class rename within project

**Agent's Input**

```yaml
tool: Rename symbol
workspace: fixtures/ledger
file: packages/accounts/src/account.ts
position: {"line":37,"character":14}
newName: InMemoryAccountStore

# answered in 6ms
```

**Response**

~~~text
Rename to InMemoryAccountStore · resolved MemoryAccountStore · packages/accounts/src/account.ts:37:14 · Scope: project only · packages/accounts/tsconfig.json · 2 files · 2 edits

*** Begin Patch
*** Update File: packages/accounts/src/account.ts
@@
   open(account: Account): void;
 }
 
-export class MemoryAccountStore implements AccountStore {
+export class InMemoryAccountStore implements AccountStore {
   private readonly accounts = new Map<AccountPath, Account>();
 
   get(path: AccountPath): Account | undefined {
*** Update File: packages/accounts/src/index.ts
@@
   type AccountPath,
   type AccountStore,
   lineage,
-  MemoryAccountStore,
+  InMemoryAccountStore as MemoryAccountStore,
   normalBalance,
   parentPath,
 } from "./account.ts";
*** End Patch
~~~

