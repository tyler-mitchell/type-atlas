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

## importer module outline

```yaml
tool: Document symbols
workspace: fixtures/ledger
file: packages/importers/src/csv.ts
```

~~~text
=== packages/importers/src/csv.ts · 4 top-level symbols ===

HEADER [variable] 13:7-13:13 · range 13:7-13:50
importStatement [variable] 28:14-28:29 · range 28:14-47:2
parseStatement [variable] 15:14-15:28 · range 15:14-25:2
StatementRow [interface] 6:18-6:30 · range 6:1-11:2

3 hints in packages/importers/src/csv.ts
~~~

## generic module outline

```yaml
tool: Document symbols
workspace: fixtures/ledger
file: packages/rules/src/rule.ts
```

~~~text
=== packages/rules/src/rule.ts · 9 top-level symbols ===

AccountPattern [interface] 35:13-35:27 · range 35:1-35:58
evaluate [variable] 46:14-46:22 · range 46:14-56:2
matches [variable] 37:14-37:21 · range 37:14-38:90
PayloadOf [interface] 27:13-27:22 · range 27:1-29:11
RuleBook [interface] 41:13-41:21 · range 41:1-43:3
RuleEvent [interface] 14:13-14:22 · range 14:1-14:56
RuleEvents [interface] 8:18-8:28 · range 8:1-12:2
RuleHandler [interface] 19:13-19:24 · range 19:1-21:14
Verdict [interface] 17:13-17:20 · range 17:1-17:101
~~~

