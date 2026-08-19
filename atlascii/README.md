# atlascii

ASCII components for code intelligence.

Renders the shapes a language server produces — locations, navigation targets,
call hierarchies, outlines, diagnostics, source frames — as plain text meant to
be read by an agent from a transcript.

## What it is

Pure functions. Data in, string out. No colour, no terminal, no framework, no
document layer. Every component takes the protocol's own values — an LSP
`Range`, a severity number — and does the formatting itself, so a caller never
formats anything before calling.

That constraint is the whole design. A component that took `"12:7-12:18"`
instead of a `Range` would be asking its caller to do the library's job, and
would leave every consumer with its own copy of the zero-based-to-one-based
conversion. Here that conversion exists once, in `range.ts`.

## Layers

```
source-offset.ts   position ↔ offset arithmetic. No strings at all.
range.ts           positions and ranges as text. One conversion point.
                   ↑ everything below builds on these

code-frame.ts      source excerpt with a gutter and span carets
locations.ts       located rows grouped by file (ripgrep --heading -n)
targets.ts         navigation targets (❯ file:line:col)
calls.ts           call hierarchy, one file, indented callables
symbols.ts         document outline, ctags kinds, depth nesting
workspace-symbols.ts   symbol search hits with containers
diagnostics.ts     compiler-style problems

divider.ts         section rule, centred or right-anchored text
summary.ts         right-aligned label column, singular/plural
time.ts            durations that stop being milliseconds past a second
```

## Prior art

The layout primitives are adapted from Vitest's reporters — `divider`,
`padSummaryTitle`, `formatTime`, the code frame's gutter and caret arithmetic,
the `❯` frame, and the rule that a row never prints a zero state. Vitest solves
the same problem this does: dense, scannable, colour-optional text about code,
read quickly by someone who did not write it.

The transplanted source is kept at
`packages/core/src/markdoc/format/vitest-reference/` with an extraction log.

## Status

Early. The components here are in use by Type Atlas, an MCP server for
TypeScript code intelligence, which is where each one was shaped against real
agent-facing output rather than designed in advance.

Not yet extracted from that project: the diff body (`-`/`+` unified lines),
state glyphs, count lines, stack frames, breadcrumbs, tree rows, and an
indented-block writer.
