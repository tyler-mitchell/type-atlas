<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `format_document`

Return a Codex patch containing document-formatting edits. The MCP does not modify files.

## mangled file

**Agent's Input**

```yaml
tool: Format document
workspace: fixtures/ledger
file: packages/importers/src/dedupe.ts
# answered in 4ms
```

**Response**

~~~text
Format document · 1 file · 28 edits

*** Begin Patch
*** Update File: packages/importers/src/dedupe.ts
@@
 import type { StatementRow } from "./csv.ts";
 
 /** Rows a bank exports twice — same day, description, and amount. */
-export const duplicates=(rows:readonly StatementRow[]):readonly StatementRow[]=>{
-    const seen=new Set<string>()
-    const twice:StatementRow[]=[]
-  for(const row of rows){
-      const key=`${row.postedOn}|${row.description}|${row.amountMinor}`
-        if(seen.has(key)){twice.push(row)}else{seen.add(key)}
+export const duplicates = (rows: readonly StatementRow[]): readonly StatementRow[] => {
+  const seen = new Set<string>()
+  const twice: StatementRow[] = []
+  for (const row of rows) {
+    const key = `${row.postedOn}|${row.description}|${row.amountMinor}`
+    if (seen.has(key)) { twice.push(row) } else { seen.add(key) }
   }
-    return twice
+  return twice
 }
 
 const unusedBatchLimit = 500;
*** End Patch
~~~

