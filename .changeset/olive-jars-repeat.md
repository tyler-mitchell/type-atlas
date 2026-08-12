---
"@type-atlas/core": patch
---

Recycle an idle workspace after 45 seconds rather than 30 minutes.

The 30 minute timeout was introduced to remove a delay that turned out to have
other causes, and at that length it stops being a cache and retains the language
server for a whole session. Its heap only grows: one observed session reached
1.8 GB after 75 minutes, and exhausting it kills the workspace along with every
request in flight, which costs the call, reports only that the connection was
disposed, and pays the reload anyway.

Reloading costs about 5.5 seconds on a mid-sized monorepo against 5 milliseconds
warm, paid once per idle gap and amortized over the calls that follow. A
predictable few seconds is the better trade against an unpredictable crash.

This bounds idle processes only. A workspace called steadily never idles out, so
heap growth during active work is not addressed here.

A language server that exits mid-request now says so. Its exit disposes the
connection, and the rejection every pending request then saw described the
transport rather than what happened, which reads as a transient fault and
invites an identical retry. The error now names the exit, that the server starts
again on the next call, and that a request which keeps ending this way is too
large to answer at once.
