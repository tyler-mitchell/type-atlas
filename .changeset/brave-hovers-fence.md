---
"@type-atlas/core": patch
"@type-atlas/mcp": patch
---

Keep the code fence that separates a declaration from its documentation in
hover output. Hover markup carries both a signature and prose, and stripping the
fence ran them together as one block, so `hover`, `inspect_symbol`, and
`explore_symbol` gave no cue for where the declaration ended and the doc comment
began. Documentation-only markup in signature help, completions, module exports,
and inlay hints is still rendered as plain prose.
