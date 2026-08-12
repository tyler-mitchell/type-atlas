---
"@type-atlas/mcp": patch
---

Publish `snippetLines` as a plain bounded integer.

It was declared `null | 0 <= number.integer <= 30`, and a property whose schema
is a choice publishes without a type, so a client coerces whatever is sent to a
string: `search_dependency_code` rejected `snippetLines: 12` because it arrived
as `"12"`. The bound is now published alone, across `search_code`,
`related_code`, `investigate_code`, `explore_symbol`, and
`search_dependency_code`.

`null` requested the complete chunk. Every match already names its file and
line, so reading further is `read_file`'s job rather than a shape this parameter
has to carry.

`test/tool-schemas.test.ts` now asserts that every published property declares a
concrete `type` or `enum` of its own, which is what this violated. A choice
nested below a typed property stays allowed: `read_file.file` publishes
`type: "array"` whose items may be a path or a bounded view, and the container
naming the shape is what lets those elements travel as the JSON they are.
