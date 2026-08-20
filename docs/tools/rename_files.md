<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `rename_files`

Return a Codex patch that moves files and updates affected references. The MCP does not modify files.

## module move updates importers

```yaml
tool: Rename files
workspace: fixtures/ledger
files: [{"from":"packages/accounts/src/posting.ts","to":"packages/accounts/src/entry-side.ts"}]
```

~~~text
Rename · 3 files · 2 edits

*** Begin Patch
*** Update File: packages/accounts/src/index.ts
@@
   parentPath,
 } from "./account.ts";
 export { type Entry, Journal, UnbalancedEntryError } from "./journal.ts";
-export { credit, debit, type Posting, signedAmount } from "./posting.ts";
+export { credit, debit, type Posting, signedAmount } from "./entry-side.ts";
*** Update File: packages/accounts/src/journal.ts
@@
 import { add, isZero, type Money, zero } from "@ledger/money";
 import type { AccountPath } from "./account.ts";
-import { credit, debit, type Posting, signedAmount } from "./posting.ts";
+import { credit, debit, type Posting, signedAmount } from "./entry-side.ts";
 
 /** A balanced set of postings, recorded together or not at all. */
 export interface Entry<TMeta = undefined> {
*** Update File: packages/accounts/src/posting.ts
*** Move to: packages/accounts/src/entry-side.ts
@@
 import { type Money, negate } from "@ledger/money";
*** End Patch

References in packages/accounts/tests/journal.test.ts, packages/importers/src/csv.ts, packages/reconcile/src/matching.ts, packages/reconcile/src/drift.ts, packages/rules/src/rule.ts, packages/reports/src/balance.ts, packages/rules/src/builtin.ts were not updated — the platform's rename walk missed them and a cross-directory specifier is not assembled here. Update them before applying, or use references to find every site.
~~~

