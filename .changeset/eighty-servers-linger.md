---
"@type-atlas/core": patch
"@type-atlas/mcp": patch
---

Keep a workspace's language server alive across the gaps between an agent's
calls. The idle window was 60 seconds, which suits an editor but not an agent:
agents reason between tool calls and interleave reads, edits, and shell
commands, so the window expired constantly and the next call rebuilt the whole
TypeScript program.

Measured on this repository, a call following a 65 second pause took 1625ms and
now takes 25ms. Calls made in quick succession were already fast and are
unchanged.
