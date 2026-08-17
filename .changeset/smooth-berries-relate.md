---
"@type-atlas/mcp": minor
---

Stop giving every searched directory an index of its own.

`search_code` and `related_code` handed `directory` to semble as the repository
to index. Semble keys its cache on a hash of the resolved path, so a directory
and the workspace containing it never share an index: naming the directory built
a second one from scratch. On a real example — a traffic-policy directory inside
`webgpu-engine` — that was thirteen seconds, paid for a narrowing that was asked
for to make the search cheaper, and paid again for every other directory an agent
scoped to.

The workspace is the index now, and the directory selects from its results.
Semble's search takes no path filter, so a scoped page is filled by asking the
workspace index for a wider one and keeping what falls under the directory; a
warm search costs tens of milliseconds, so asking twice is far cheaper than
building a second index. If the workspace index genuinely does not hold enough
under that directory, the directory is indexed after all — the answer is never
worse than before, only faster in the common case. Result paths are reported
against the search root either way, so a scoped page reads the same however it
was obtained.

A directory-scoped search that had never been indexed went from thirteen seconds
to 263ms.
