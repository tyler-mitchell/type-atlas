---
"@type-atlas/core": minor
---

Bound a language server that has stopped answering.

A semantic request cannot be cancelled. The token Volar hands TypeScript raises
nothing, so a request abandoned at five seconds runs to completion at nearly ten,
and while it runs the server holds its only thread and stops reading its socket.
Every later call for that workspace waits behind it — a folded five-line read
needing no type checking has timed out at thirty seconds that way. Ending the
process is the only bound a client has.

A request that runs past sixty seconds now ends its server and says so. Sixty is
longer than the slowest legitimate answer measured here, a cold whole-project
check of a three-thousand-file program, so a slow project is not mistaken for a
stuck one. The cost is one project rebuild on the next call, against a queue
bounded only by however long the abandoned work runs.

This fires on the deadline rather than on a caller giving up, because a caller
giving up says nothing about whether the server is stuck, and a cheap request
someone cancelled is not worth a rebuild. The pool already replaces a workspace
whose process exits, so the next call starts a fresh one.
