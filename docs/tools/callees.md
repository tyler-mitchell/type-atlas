<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `callees`

Show which callable symbols are invoked directly by the function at a position, grouped with exact call sites. Use this instead of references when tracing outgoing execution flow.

## what balances as of invokes

```yaml
tool: Callees
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
position: {"line":23,"character":14}
```

~~~text
balancesAsOf · calls 12 callables

packages/accounts/src/account.ts
└  lineage [function] 27:14-27:21 · range 27:24-28:86 · calls 40:28-40:35
packages/accounts/src/posting.ts
└  signedAmount [function] 25:14-25:26 · range 25:29-32:2 · calls 34:57-34:69
packages/money/src/money.ts
├  zero [function] 30:14-30:18 · range 30:21-30:71 · calls 34:41-34:45, 41:56-41:60, 48:32-48:36
└  add [function] 32:14-32:17 · range 32:20-37:2 · calls 34:9-34:12, 41:28-41:31

and 8 standard-library calls · entries, get, localeCompare, map, set, sort
~~~

## what a method invokes

```yaml
tool: Callees
workspace: fixtures/ledger
file: packages/accounts/src/journal.ts
position: {"line":28,"character":3}
```

~~~text
post invokes nothing the owning project resolves. A call to something the project cannot resolve is not reported here — diagnostics say why a name does not resolve.
~~~

