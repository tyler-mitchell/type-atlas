<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `rename_symbol`

Return a Codex patch for a TypeScript-project symbol rename at a source position. The MCP does not modify files.

## rename across packages

```yaml
tool: Rename symbol
workspace: fixtures/ledger
file: packages/accounts/src/account.ts
position: {"line":18,"character":14}
newName: balanceSide
```

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

