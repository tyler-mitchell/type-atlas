<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `hover`

Return type and documentation hover at a position.

## overloaded method

```yaml
tool: Hover
workspace: fixtures/ledger
file: packages/accounts/src/journal.ts
position: {"line":28,"character":3}
```

~~~text
packages/accounts/src/journal.ts:28:3

```typescript
(method) Journal<TMeta = undefined>.post(entry: Entry<TMeta>): Entry<TMeta>;
```

Record a prepared entry, or build the common two-posting transfer.
~~~

## branded type

```yaml
tool: Hover
workspace: fixtures/ledger
file: packages/money/src/money.ts
position: {"line":12,"character":13}
```

~~~text
packages/money/src/money.ts:12:13

```typescript
type Money = { readonly minorUnits: bigint; readonly currency: Currency; readonly [brand]: "Money"; }
```

An exact amount of one currency, held in minor units (cents, pence, yen).

The brand keeps a raw `{ amount, currency }` literal out of ledger math:
every `Money` passed through the system was constructed by `money()` and is
therefore integral and currency-tagged.
~~~

