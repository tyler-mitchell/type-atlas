---
"@type-atlas/core": patch
---

Give a workspace's language server a heap ceiling proportional to the machine.

A forked child inherits none of the parent's exec arguments and takes Node's
default, which lands near 4 GB on a 16 GB machine. One TypeScript program per
package is real working set rather than waste, and a monorepo with several large
packages loaded at once reached that default and aborted, leaving most of the
machine unused. The ceiling is now half of total memory, bounded to between 2 GB
and 8 GB, so it stays proportional on smaller machines where raising it blindly
would trade a crash for swapping.

This defers exhaustion rather than removing it. Nothing bounds how many projects
a session loads, and Volar's `project.reload()` is the affordance for reclaiming
them if that becomes the failure again.
