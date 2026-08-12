---
"@type-atlas/core": patch
---

Descend into a folded body when it would otherwise hide the file's structure.

The outermost eligible range wins at each line, so one long body swallowed every
declaration beneath it. Reading a 324-line module whole collapsed lines 166-322
to a single placeholder under `return {`, hiding `capture`, `dispose`, `state$`,
and `restore` — the module's entire public surface, and the reason to open the
file. The line above a fold usually names what it hides; an object or return
body names nothing.

A range that hides more than a third of the view is now dropped in favour of the
ranges inside it, which surfaces those members with their own bodies folded, for
five lines. Only when children exist: a long body with no foldable range inside
keeps its placeholder, since discarding it would print every line instead.
