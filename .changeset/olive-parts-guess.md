---
"@type-atlas/core": patch
---

Answer "nothing changed" without checking the project.

`diagnostics` defaults to the files written since the workspace opened. With none
written, the empty file list fell through to every loaded project, and the filter
that narrows a report to the changed files cannot narrow an empty list — so the
whole project came back under a heading that said "changed files". On a
1,768-file project that was 28.6 seconds to answer a question whose answer was
already known.

It now says so in 6ms, and names the two ways to ask for the check anyway.
