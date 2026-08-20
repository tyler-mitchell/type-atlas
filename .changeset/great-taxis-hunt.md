---
"@type-atlas/language-server": patch
---

Keep configured language-service plugins in a project diagnostic scan.

A project check asked the program for every file's diagnostics at once. That
reads as the cheap way to do it, and it silently dropped every diagnostic a
project's configured TypeScript language-service plugin contributes: the Effect
adapter this repository ships routes through the decorated language service only
when `getSemanticDiagnostics` is called _with_ a source file, and falls back to
the raw program when called with none. A project configuring
`@effect/language-service` therefore saw its own diagnostics in `tsc` and not
here.

The scan now runs file by file over the same program, which is how the plugin
contract is entered, and the comment on it records what it is: a knowing
deviation from the evidence ledger's prescription of Volar's own per-file
`getDiagnostics`, taken because that path re-enters the semantic provider for
every document with no short-circuit, and bounded by this server registering no
virtual-code language plugin.
