---
"@type-atlas/core": patch
---

Keep an idle workspace for five minutes rather than forty-five seconds.

Reloading rebuilds the TypeScript program, about 5.5 seconds on a mid-sized
monorepo against 5 milliseconds warm. Agents pause far longer than a person
typing — reading a result, writing a patch, running a command — so a
forty-five second timeout charged that reload repeatedly for work the process
was about to be asked to do anyway.

That value was chosen while the heap grew roughly 18 MB per module probe with no
plateau, reaching 1.8 GB in one session, when a short timeout was the only thing
bounding it. The leak is fixed and the fork now has an explicit ceiling, so this
is free to serve latency, which is its purpose. Minutes cover an agent's gaps
while still releasing a workspace it has finished with, where a session-length
timeout would not.
