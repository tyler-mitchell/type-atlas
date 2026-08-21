<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `verify_edit`

Experimental: the diagnostics a proposed edit would introduce, before anything is written. Each file's complete proposed content is checked in memory against the file as it stands; the answer reports what the change introduces and resolves in those files. A change can also break importers — diagnostics after applying reports those.

## proposed edit breaks a consumer

**Agent's Input**

```yaml
tool: Verify edit
workspace: fixtures/ledger
files: [{"path":"packages/money/src/money.ts","content":"import { type Currency, currencyProfiles } from \"./currency.ts\";\n\ndeclare const brand: unique symbol;\n\nexport type Money = {\n  readonly minorUnits: bigint;\n  readonly currency: Currency;\n  readonly [brand]: \"Money\";\n};\n\nexport const money = (minorUnits: bigint, currency: Currency): Money =>\n  ({ minorUnits, currency }) as Money;\n\nexport const zero = (currency: Currency): Money => money(0n, currency);\n\nexport const profileOf = (currency: Currency) => currencyProfiles[currency];\n"}]
```

**Response**

~~~text
The proposed edit introduces no problem the 1 file does not already have. Only these files were checked — a change can also break importers, and diagnostics after applying reports those.
~~~

