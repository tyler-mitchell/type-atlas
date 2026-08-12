---
"@type-atlas/language-server": minor
"@type-atlas/core": minor
"@type-atlas/mcp": minor
---

Answer `references` from every loaded TypeScript project instead of only the one
owning the file.

Volar resolves positional requests to a single language service, so in a
monorepo whose packages import each other's source a symbol's usages in sibling
packages were absent even though those projects hold the same file and can
answer for it. Asking `TimelineExactCoordinate` in one package returned 206
usages, all inside it, while a sibling package used the type on the first line
of a file the project already had loaded.

Each loaded project now answers and the results are merged, which raised that
same query to 219. The owning project is loaded first, since only loaded
projects can be enumerated and the one guaranteed to hold the document might not
be among them. Projects nothing has opened yet still cannot contribute, and
querying a warm project costs about ten milliseconds against the seconds it
takes to load a cold one, so loading them is left to the agent: touch a file in
the package you expect to hear from.

`inspect_symbol` reports its references the same way, since it asks the same
request. `callers`, `callees`, `implementations`, and `file_references` are
unchanged and remain bounded to the owning project.

`references` and `workspace_symbols` now report `Scope: loaded projects · anchor
<project>` rather than claiming a single project. `formatWorkspaceSymbolScope`
is renamed `formatLoadedProjectScope` in `@type-atlas/core/text`, since both
report the same thing.
