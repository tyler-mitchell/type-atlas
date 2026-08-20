<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `document_links`

Return resolved links discovered by the active language service in a Markdown or JSON document.

## json schema reference

```yaml
tool: Document links
workspace: fixtures/ledger
file: ledger.config.json
```

~~~text
Nothing in ledger.config.json links anywhere. A link is a target an editor can follow — a Markdown link, a JSON $schema — and a TypeScript import is not one of them, so a module full of imports reports none here. For what a module imports, read it; for what imports it, use file_references.
~~~

## fixture readme

```yaml
tool: Document links
workspace: fixtures/ledger
file: README.md
```

~~~text
README.md names 1 link.

README.md
└  5:22-5:73:  ../../packages/mcp/test/scenarios/scenarios.test.ts
~~~

