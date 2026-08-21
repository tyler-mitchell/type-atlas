<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `signature_help`

Return overload and parameter information at a call site.

## inside a call

**Agent's Input**

```yaml
tool: Signature help
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
position: {"line":34,"character":13}

# answered in 6ms
```

**Response**

~~~text
packages/reports/src/balance.ts:34:13 · 1 signature

add(left: Money, right: Money): Money
├  left: Money · active
└  right: Money
~~~

## overload and second argument

**Agent's Input**

```yaml
tool: Signature help
workspace: fixtures/ledger
file: packages/accounts/tests/journal.test.ts
position: {"line":9,"character":5}

# answered in 6ms
```

**Response**

~~~text
packages/accounts/tests/journal.test.ts:9:5 · 2 signatures · number 2 in use

post(entry: Entry<undefined>): Entry<undefined>
└  entry: Entry<undefined>
post(description: string, transfer: { from: AccountPath; to: AccountPath; amount: Money; }, meta: undefined): Entry<undefined>
├  description: string
├  transfer: { from: AccountPath; to: AccountPath; amount: Money; } · active
└  meta: undefined
~~~

