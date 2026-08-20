<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `inlay_hints`

Return inline type and parameter hints for a source range.

## inferred types in a loop

```yaml
tool: Inlay hints
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
range: {"start":{"line":28,"character":1},"end":{"line":37,"character":1}}
```

~~~text
packages/reports/src/balance.ts:28:1-37:1 · 7 hints

33:9 key:
34:9 value:
34:13 left:
34:21 key:
34:46 currency:
34:57 right:
34:70 posting:
~~~

