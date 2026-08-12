---
"@type-atlas/core": patch
---

Group located results under each file rather than repeating its path per hit.

`references` and `file_references` printed one fully qualified path per result,
so ten uses in one file cost ten copies of a path to introduce ten line numbers,
and read as ten unrelated results. Ten hits in a single file dropped from about
570 characters to 200.

Each file is now named once, followed by its positions in source order, matching
how callers and calls are already reported.
