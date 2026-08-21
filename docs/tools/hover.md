<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `hover`

Return type and documentation hover at a position.

## overloaded method

**Agent's Input**

```yaml
tool: Hover
workspace: fixtures/ledger
file: packages/accounts/src/journal.ts
position: {"line":28,"character":3}

# answered in 10ms
```

**Response**

~~~text
packages/accounts/src/journal.ts:28:3

```typescript
(method) Journal<TMeta = undefined>.post(entry: Entry<TMeta>): Entry<TMeta>;
```

Record a prepared entry, or build the common two-posting transfer.
~~~

## branded type

**Agent's Input**

```yaml
tool: Hover
workspace: fixtures/ledger
file: packages/money/src/money.ts
position: {"line":12,"character":13}

# answered in 31ms
```

**Response**

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

## constant with documentation

**Agent's Input**

```yaml
tool: Hover
workspace: fixtures/ledger
file: packages/money/src/currency.ts
position: {"line":12,"character":14}

# answered in 17ms
```

**Response**

~~~text
packages/money/src/currency.ts:12:14

```typescript
const currencyProfiles: Record<Currency, CurrencyProfile>
```
~~~

## jsdoc with inline link

**Agent's Input**

```yaml
tool: Hover
workspace: fixtures/ledger
file: packages/money/src/money.ts
position: {"line":38,"character":14}

# answered in 6ms
```

**Response**

~~~text
packages/money/src/money.ts:38:14

```typescript
const add: (left: Money, right: Money) => Money
```

Exact addition in minor units.

*@throws* — CurrencyMismatchError when the currencies differ — ledger
math never converts silently.
~~~

## conditional type

**Agent's Input**

```yaml
tool: Hover
workspace: fixtures/ledger
file: packages/rules/src/rule.ts
position: {"line":27,"character":13}

# answered in 4ms
```

**Response**

~~~text
packages/rules/src/rule.ts:27:13

```typescript
type PayloadOf<TMeta, TEvent> = TEvent extends keyof RuleEvents<TMeta> ? RuleEvents<TMeta>[TEvent] : never
```

The payload a given event name carries — conditional extraction, so a
consumer can name the payload of one event without writing the map out.
~~~

## template literal pattern

**Agent's Input**

```yaml
tool: Hover
workspace: fixtures/ledger
file: packages/rules/src/rule.ts
position: {"line":35,"character":13}

# answered in 4ms
```

**Response**

~~~text
packages/rules/src/rule.ts:35:13

```typescript
type AccountPattern = string
```

An account matcher: a literal path, or a template-literal prefix pattern —
`"assets:bank:*"` matches every account under that branch.
~~~

