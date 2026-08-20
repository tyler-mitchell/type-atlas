<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `document_symbols`

Return the top-level document outline and source ranges. Set depth to include nested symbols or raw to return the complete hierarchy.

## journal outline

```yaml
tool: Document symbols
workspace: fixtures/ledger
file: packages/accounts/src/journal.ts
```

~~~text
=== packages/accounts/src/journal.ts · 3 top-level symbols ===

Entry [interface] 6:18-6:23 · range 6:1-11:2
Journal [class] 24:14-24:21 · range 24:1-73:2
UnbalancedEntryError [class] 13:14-13:34 · range 13:1-17:2
~~~

## broken file answers with diagnostics

```yaml
tool: Document symbols
workspace: fixtures/ledger
file: packages/reconcile/src/drift.ts
```

~~~text
=== packages/reconcile/src/drift.ts · 3 top-level symbols ===

drift [variable] 19:14-19:19 · range 19:14-22:2
StatementLine [interface] 8:18-8:31 · range 8:1-12:2
statementTotal [variable] 15:14-15:28 · range 15:14-16:56

4 problems in packages/reconcile/src/drift.ts
~~~

