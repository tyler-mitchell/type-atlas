<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `organize_imports`

Return the TypeScript organize-imports action as a Codex patch. The MCP does not modify files.

## messy import block

**Agent's Input**

```yaml
tool: Organize imports
workspace: fixtures/ledger
file: packages/importers/src/csv.ts
# answered in under 1s
```

**Response**

~~~text
Organize Imports · 1 file · 3 edits

*** Begin Patch
*** Update File: packages/importers/src/csv.ts
@@
-import { Journal, type Entry, credit, debit, type AccountPath } from "@ledger/accounts";
-import { type Currency, isCurrency, money, zero, format } from "@ledger/money";
 import type { Posting } from "@ledger/accounts";
+import { credit, debit, Journal, type AccountPath } from "@ledger/accounts";
+import { isCurrency, money, type Currency } from "@ledger/money";
 
 /** One parsed row of a bank's CSV export. */
 export interface StatementRow {
*** End Patch

3 hints in packages/importers/src/csv.ts
~~~

