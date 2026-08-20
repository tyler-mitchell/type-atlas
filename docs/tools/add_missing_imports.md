<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `add_missing_imports`

Return TypeScript's source-wide missing-import fixes as a Codex patch. The MCP does not modify files.

## forgotten imports

```yaml
tool: Add missing imports
workspace: fixtures/ledger
file: packages/reconcile/src/matching.ts
```

~~~text
Add all missing imports · 1 file · 4 edits

*** Begin Patch
*** Update File: packages/reconcile/src/matching.ts
@@
 // DELIBERATELY BROKEN — the imports for `money` and `signedAmount` are
 // missing, so `add_missing_imports` scenarios have real work to do. Do not
 // fix; see the fixture README.
-import type { Posting } from "@ledger/accounts";
+import { signedAmount, type Posting } from "@ledger/accounts";
 import type { StatementLine } from "./drift.ts";
+import { money } from "../../money/src/money.ts";
 
 /** Pair journal postings with the statement lines they explain. */
 export const matchPostings = (
*** End Patch

2 problems in packages/reconcile/src/matching.ts
~~~

