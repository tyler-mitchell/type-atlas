<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `explore_symbol`

Combine exact definitions, types, implementations, callers, calls, and references for one symbol with structurally similar code. Verified relationships and similarity are separate.

## function with similarity tail

**Agent's Input**

```yaml
tool: Explore symbol
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
symbol: balancesAsOf

# answered in 49ms
```

**Response**

~~~text
balancesAsOf [function] · packages/reports/src/balance.ts:23:14-23:26 · range 23:14-51:2 · packages/reports/tsconfig.json

## Calls (4 workspace · 6 dependency/runtime)

Every call site is in packages/reports/src/balance.ts; each row names where the callee is declared.

packages/accounts/src/account.ts
└  lineage [function] 27:14-27:21 · range 27:24-28:86 · calls 40:28-40:35
packages/accounts/src/posting.ts
└  signedAmount [function] 25:14-25:26 · range 25:29-32:2 · calls 34:57-34:69
packages/money/src/money.ts
├  zero [function] 30:14-30:18 · range 30:21-30:71 · calls 34:41-34:45, 41:56-41:60, 48:32-48:36
└  add [function] 38:14-38:17 · range 38:20-43:2 · calls 34:9-34:12, 41:28-41:31

Dependency/runtime: localeCompare, entries, map, sort, get, set

Related code · similarity is not a call or reference relationship
Search: Related to packages/reports/src/balance.ts:23

3 matches · no identifier to anchor on, so these are ranked by meaning alone

=== 1 · packages/accounts/src/journal.ts:19-38 ===

Structure: Journal
Symbol: Journal [class] · selection 24:14-24:21 · range 24:1-73:2

=== 2 · packages/rules/src/rule.ts:1-16 ===

Structure: RuleEvents
Symbol: RuleEvents [interface] · selection 8:18-8:28 · range 8:1-12:2

=== 3 · packages/reconcile/src/drift.ts:1-18 ===

Structure: StatementLine
Symbol: StatementLine [interface] · selection 8:18-8:31 · range 8:1-12:2
~~~

