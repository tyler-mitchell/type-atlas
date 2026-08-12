---
"@type-atlas/core": patch
---

Stop `callees` from repeating one call site per resolved overload.

A call to a standard library method resolves to every overload that matched, and
each arrived as a separate callee carrying the same range. One
`listModuleExports` reported `Object.keys` twice, from `lib.es5.d.ts` and
`lib.es2015.core.d.ts`, each listing the identical range sixteen times, and the
four callees that located real work sat under roughly four thousand characters
of standard library paths.

Ranges are now deduplicated, and dependency targets collapse to their distinct
names on one line — the treatment `inspect_symbol` already gives its calls —
leaving workspace targets readable. `callers` was unaffected, since callers of a
workspace symbol are workspace code.

`document_links` no longer prints the "Follow link" tooltip the Markdown
language service attaches to every resolvable link, which doubled that output
while saying nothing the arrow does not. A tooltip carrying real information is
still shown.
