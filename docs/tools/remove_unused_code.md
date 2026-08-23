<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `remove_unused_code`

Return TypeScript's source-wide unused-code removal as a Codex patch. The MCP does not modify files.

## dead helpers

**Agent's Input**

```yaml
tool: Remove unused code
workspace: fixtures/ledger
file: packages/importers/src/dedupe.ts

# answered in 18ms
```

**Response**

~~~text
Remove all unused code · 1 file · 2 edits

*** Begin Patch
*** Update File: packages/importers/src/dedupe.ts
@@
     return twice
 }
 
-const unusedBatchLimit = 500;
 
-function legacyKeyOf(row: StatementRow): string {
-  return [row.postedOn, row.description].join("::");
-}
*** End Patch

=== packages/importers/src/dedupe.ts ===

hint ts(6133) 16:10-16:21
  'legacyKeyOf' is declared but its value is never read.

2 hints in packages/importers/src/dedupe.ts · 1 more not shown · includeDiagnostics: verbose shows all
~~~

