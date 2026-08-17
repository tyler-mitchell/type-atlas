---
"@type-atlas/core": patch
"@type-atlas/mcp": patch
---

Stop reporting a declaration as its own implementation.

The implementation request returns the declaration itself for anything that is
not overridden, which is most TypeScript. `implementations` printed that as
"Implementations (1)" pointing back at the position asked about — the opposite of
what it means. It now reports none, and says the declaration is not overridden.

Definitions are unchanged: there, returning the declaration is the answer.
