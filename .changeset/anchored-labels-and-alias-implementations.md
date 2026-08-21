---
"@type-atlas/mcp": patch
---

A retrieval hit is labelled by the declaration its snippet shows. The anchor was
chosen against the chunk retrieval matched, but the snippet re-centres on the
query's own identifier, so the two windows differ — `AccountStore` titled six
lines that showed `parentPath`, and the position an agent would carry into its
next call pointed at a declaration absent from the code beside it. A match now
carries both anchors, because they answer different questions: the matched
declaration still drives relationship expansion, and only the label follows the
printed window. Collapsing them into one was the first attempt and it cost
`investigate_code` its verified-relationships section.

Choosing that label needed both halves of the obvious rule. Raw overlap named a
class for six lines of one method, the method's doc comment belonging to the
class and giving it one extra line; pure containment fixed that and named a
one-line property for a six-line config object, because anything small and
wholly inside the window scores perfectly. The score squares the overlap before
dividing by the declaration's own length, so a label must both fill the window
and not sprawl past it.

`inspect_symbol` no longer reports implementations for a type alias. Nothing
implements one — `implements` cannot name an alias — so every entry the walk
returned was a variable annotated with it, and which entries it returned was not
even stable: a packed build on Linux listed a `readonly Money[]` constant under
`Money` where the same question answered nothing on macOS.
