---
"@type-atlas/language-server": patch
---

Answer references from the project that owns the file, as Volar does.

An earlier change queried every loaded project so a symbol's usages in sibling
packages would appear. It worked, and it made the hottest tool unusable:
`inspect_symbol` asks the same request, so once a second project loaded, an
identical repeated call went from 21ms to 3830ms — 180 times slower — and grew
with every further project a session touched.

Cross-package usages are worth having, but not at that price on every symbol
lookup. References are project-scoped again, and each result says so.
