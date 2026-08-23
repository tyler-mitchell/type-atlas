<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `references`

Return a bounded page of reference locations, across every project loaded this session unless scope narrows it. Set raw to return the complete scope instead of one page.

## type used across packages

**Agent's Input**

```yaml
tool: References
workspace: fixtures/ledger
file: packages/money/src/money.ts
position: {"line":12,"character":13}

# answered in 84ms
```

**Response**

~~~text
Money [type] · packages/money/src/money.ts:12:13
37 references · 6 relevant projects searched · packages/money/tsconfig.json

1-20 of 37 references · pass offset: 20 for the rest

packages/accounts/src/journal.ts
├  1:28  — at module level
├  14:35 — inside constructor
├  31:61 — inside post
└  36:62 — inside post
packages/accounts/src/posting.ts
└  25:49 — inside signedAmount
packages/money/src/index.ts
└  7:8 — at module level
packages/money/src/money.ts
├  27:73 — inside money
├  28:53 — inside money
├  30:43 — inside zero
├  38:27 — inside add
├  38:41 — inside add
├  38:49 — inside add
├  45:31 — inside negate
├  45:39 — inside negate
├  47:31 — inside isZero
└  50:31 — inside format
packages/money/tests/rounding-parity.ts
├  1:15  — at module level
├  9:44  — inside assertRoundingParity
├  9:58  — inside assertRoundingParity
└  15:38 — inside paritySamples
~~~

## function with scoped answer

**Agent's Input**

```yaml
tool: References
workspace: fixtures/ledger
file: packages/accounts/src/account.ts
position: {"line":18,"character":14}

# answered in 50ms
```

**Response**

~~~text
normalBalance [function] · packages/accounts/src/account.ts:18:14
3 references · 5 relevant projects searched · packages/accounts/tsconfig.json

packages/accounts/src/index.ts
└  8:3 — at module level
packages/reports/src/statement.ts
├  1:24 — at module level
└  9:17 — inside shown
~~~

## enum member

**Agent's Input**

```yaml
tool: References
workspace: fixtures/ledger
file: packages/money/src/rounding-mode.ts
position: {"line":4,"character":3}

# answered in 77ms
```

**Response**

~~~text
HalfEven [enum member] · inside RoundingMode · packages/money/src/rounding-mode.ts:4:3
2 references · 6 relevant projects searched · packages/money/tsconfig.json

packages/money/src/rounding-mode.ts
├  10:34 — inside "first-national"
└  15:38 — inside roundingModeOf
~~~

