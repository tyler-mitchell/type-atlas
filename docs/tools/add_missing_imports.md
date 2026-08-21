<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `add_missing_imports`

Return TypeScript's source-wide missing-import fixes as a Codex patch. The MCP does not modify files.

## forgotten imports

**Agent's Input**

```yaml
tool: Add missing imports
workspace: fixtures/ledger
file: packages/reconcile/src/matching.ts
# answered in 61ms
```

**Response**

~~~text
The language service offered no import fixes, although 2 names in this file do not resolve. If an import should exist for them, write it by hand — the engine proposed none.

2 problems in packages/reconcile/src/matching.ts
~~~

