---
"@type-atlas/core": patch
---

Start a file's project when the file is first read.

Reading deliberately never reaches the language server — the text comes from
disk and the folding ranges from a parser over that text — so nothing builds the
project until the first question that needs types, and that question waits for
the whole program. A session opens by reading, so the build could have been
running the entire time.

Reading now asks which project owns the file and throws the answer away. That is
the cheapest request that makes Volar resolve and build the project, so the build
runs alongside the reads that follow. Reads are unaffected: they are answered
from disk before the request is sent, and measured at 13ms and 28ms with it in
place.

The size of the saving is not established. The before-figure this would be
compared against was taken while five language servers held programs for the same
monorepo, so it is not a baseline worth quoting, and the after-figure varies with
what the compiler still has to do for the files in question. Starting the build
earlier cannot make the later question slower, and it costs the read nothing;
that is the whole claim.
