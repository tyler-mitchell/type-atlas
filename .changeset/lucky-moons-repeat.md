---
"@type-atlas/mcp": minor
---

Publish every tool as a canonical MCP object schema, so agents can see the
arguments each tool takes.

`inspect_symbol` and `explore_symbol` selected their target with a schema union
— either `{file, position}` or `{file, symbol}`. MCP publishes a tool's input as
an object schema, and a union has no properties to publish, so both tools were
advertised as taking no arguments at all. Clients sent none, and every call
failed reporting that `file` was missing. Both now take one object with
`position` and `symbol` optional, and require exactly one of them in the
handler, where the error names what was actually wrong.

Parameters that accept several values were published without a type, so clients
serialized arrays into strings. `read_file` now takes `file` as an array,
`search_dependency_code` takes `package` as an array, `list_files` takes `glob`
as an array, and `selection_ranges` takes `position` as an array. A `read_file`
entry is a path, or a `{ path, startLine, endLine, fold }` view bounding that one
file, and the top-level `startLine`, `endLine`, and `fold` apply to entries that
set none of their own.

`includeDiagnostics` was `boolean | 'verbose'`, which published no type. It is
now `'summary' | 'verbose' | 'off'`, defaulting to `summary`; `off` replaces
`false` and `summary` replaces `true`.

Enumerated parameters — `scope`, `view`, `surface`, and `only` — published
nothing at all, because attaching metadata to a union distributes it across the
branches and loses the enum. They now publish their allowed values. Defaults
that could not be serialized, including the `path` default that reached agents
as the literal string `"$ark.default"`, are gone or expressed as scalars, and
defaults declared through `.describe().default()` are now published rather than
silently dropped.

Every published parameter now carries a description, and undeclared keys are
ignored rather than failing the call.
