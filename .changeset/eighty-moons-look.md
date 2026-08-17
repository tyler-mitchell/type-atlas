---
"@type-atlas/core": minor
---

Join a workspace already open at an outer root instead of starting a second server.

Volar finds the configuration owning a file by walking up from the file, so a
server started at a monorepo already answers for every package inside it. Naming
the monorepo and then a package in it — the ordinary way an agent works — started
a second language server and rebuilt that package's program, and with it every
declaration file behind it, since `volar-service-typescript` keys its document
registry on the root as well. On this repository's engine package that was a
second copy of a 1,768-file program.

A nested root now shares the open connection while keeping its own root: paths
resolve here, files outside it are still refused, and the changed-file view is
narrowed to this subtree and reported relative to it. Handing back the outer
workspace itself does not work — it resolves a relative path against the outer
root — which is why this is a view rather than a reuse.

Measured: a symbol inspection through the nested root answered in 569ms against
4,923ms for the same inspection that had to build the program.

Two fixes to the request deadline that shipped with it. `Promise.race` abandons
the loser without stopping it, so every answered request armed a timer that ended
the server a minute later; the timer is now cleared when the request settles.
And releasing a nested root now ends the server that answers for it, rather than
dropping a view whose own disposal is deliberately inert.
