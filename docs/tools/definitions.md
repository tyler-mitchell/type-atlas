<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `definitions`

Return definition locations at a position.

## through a package import

**Agent's Input**

```yaml
tool: Definitions
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
position: {"line":6,"character":3}
```

**Response**

~~~text
signedAmount [alias] · 1 definition

packages/accounts/src/posting.ts:25:14-25:26 · range 25:1-32:3
~~~

## method call to declaration

**Agent's Input**

```yaml
tool: Definitions
workspace: fixtures/ledger
file: packages/accounts/tests/journal.test.ts
position: {"line":7,"character":25}
```

**Response**

~~~text
post [method] · 1 definition

packages/accounts/src/journal.ts:29:3-29:7 · range 29:3-33:19
~~~

