---
"@type-atlas/core": patch
---

State a completion page's shared edit span once instead of on every candidate.

Every candidate at one position replaces the same span, and TypeScript sends no
`itemDefaults`, so each item repeated it: a page of ten carried one range twenty
times and spent two lines per candidate, roughly 48 of every 52 characters on
text identical to the line above. The inserted text was repeated too, though it
is the label for a plain member and `.label` for a member access.

The span is now derived when the whole page agrees and stated once in the
header, and a candidate shows an edit only where it differs or inserts something
the label does not imply. Scanning candidates by name and kind is what the tool
is for, and that is now what the output is.
