---
"@type-atlas/mcp": patch
---

Join a semantic index already built over a containing root.

Semble keys its cache on the resolved path it is handed, so a package and the
monorepo containing it never share an index. Fixing `directory` earlier stopped a
second index per scope, but the workspace root had the same problem one level up:
naming the monorepo and then a package inside it built two indexes over
overlapping files — 13 seconds for the second, measured.

A search now uses a root already indexed in this session that contains the
requested one, and otherwise the requested one, so a session that only ever names
the package still indexes the package rather than everything above it. Results
are re-based from whichever root was indexed, so a scoped page reads the same
either way.

Measured: the package-scoped search after a monorepo-scoped one answered in 52ms.
