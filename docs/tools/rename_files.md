<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `rename_files`

Return a Codex patch that moves files and updates affected references. The MCP does not modify files.

## module move updates importers

**Agent's Input**

```yaml
tool: Rename files
workspace: fixtures/ledger
files: [{"from":"packages/accounts/src/posting.ts","to":"packages/accounts/src/entry-side.ts"}]

# answered in 90ms
```

**Response**

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
~~~

