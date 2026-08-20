---
"@type-atlas/mcp": minor
---

`list_files` fuses `git status` into the tree the way editors do: files carry their change letter (`· M`, `· U`, `· A`, `· D`, `· R`, `· !`), deleted files appear as ghost rows, and a directory holding changes anywhere beneath it says so in words — `packages/ · 139 files · 3 changed` — so one orientation call also answers "what differs from HEAD, and where". Default on (`git: false` to disable), silent outside a repository. `callees` now folds standard-library calls to one line of distinct names — the project's own calls lead, and the answer no longer varies with the directory the compiler is installed under.
