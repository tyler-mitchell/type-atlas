<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `list_module_exports`

Inspect the usable module surface visible from an importing TypeScript file. Returns runtime signatures by default, declared package subpaths at package roots, nested runtime paths on request, and exported types or their members as opt-ins.

## workspace package surface

**Agent's Input**

```yaml
tool: Inspect module
workspace: fixtures/ledger
fromFile: packages/reports/src/balance.ts
module: @ledger/money

# answered in 113ms
```

**Response**

~~~text
Seen from packages/reports/src/balance.ts · runtime surface.

=== @ledger/money · 11 exports ===

add: (alias) const add: (left: Money, right: Money) => Money
   export add
CurrencyMismatchError: (alias) class CurrencyMismatchError
   export CurrencyMismatchError
currencyProfiles: (alias) const currencyProfiles: Record<Currency, CurrencyProfile>
   export currencyProfiles
format: (alias) const format: (value: Money) => string
   export format
isCurrency: (alias) const isCurrency: (value: string) => value is Currency
   export isCurrency
isZero: (alias) const isZero: (value: Money) => boolean
   export isZero
money: (alias) const money: (minorUnits: bigint | number, currency: Currency) => Money
   export money
negate: (alias) const negate: (value: Money) => Money
   export negate
RoundingMode: (alias) enum RoundingMode
   export RoundingMode
roundingModeOf: (alias) const roundingModeOf: (bank: string) => RoundingMode
   export roundingModeOf
zero: (alias) const zero: (currency: Currency) => Money
   export zero
~~~

## surface filtered by query

**Agent's Input**

```yaml
tool: Inspect module
workspace: fixtures/ledger
fromFile: packages/reports/src/balance.ts
module: @ledger/accounts
query: balance

# answered in 87ms
```

**Response**

~~~text
Seen from packages/reports/src/balance.ts · runtime surface · matching balance.

=== @ledger/accounts · 2 exports ===

normalBalance: (alias) const normalBalance: (kind: AccountKind) => "debit" | "credit"
   export normalBalance
UnbalancedEntryError: (alias) class UnbalancedEntryError
   export UnbalancedEntryError
~~~

