<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `document_highlights`

Return same-document semantic usages at a position.

## private field within class

```yaml
tool: Document highlights
workspace: fixtures/ledger
file: packages/accounts/src/journal.ts
position: {"line":25,"character":20}
```

~~~text
entries [property] · 5 uses in this file

packages/accounts/src/journal.ts
├  25:20 — inside Journal
├  55:10 — inside post
├  61:17 — inside history
├  67:17 — inside Journal
└  71:17 — inside [Symbol.iterator]
~~~

