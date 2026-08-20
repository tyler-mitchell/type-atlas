<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `document_links`

Return resolved links discovered by the active language service in a Markdown or JSON document.

## fixture readme

```yaml
tool: Document links
workspace: fixtures/ledger
file: README.md
```

~~~text
README.md names 2 links.

README.md
├  5:25-5:76:  ../../packages/mcp/test/scenarios/scenarios.test.ts
└  6:33-6:75:  ../../packages/mcp/test/scenarios/cases.ts
~~~

