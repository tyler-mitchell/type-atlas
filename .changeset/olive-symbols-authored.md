---
"@type-atlas/core": patch
"@type-atlas/mcp": patch
---

Exclude generated declarations from `workspace_symbols`. A workspace package
consumed through its build output reported the generated declaration next to
the source it was generated from, so searching `inspectSymbol` in this
repository returned eight results where four were `dist` duplicates of the
other four.

TypeScript's navigate-to API accepts `excludeDtsFiles`, but
`volar-service-typescript` calls it with only the query and exposes no setting
for that argument, so the equivalent selection is applied to the returned
locations.
