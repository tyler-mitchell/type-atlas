---
"@type-atlas/mcp": patch
"@type-atlas/core": patch
---

Ask the language server less to answer the same questions.

`inspect_symbol` asked a document for its outline up to three times. A name
target needed it to resolve the name; a position target then asked again to find
the declaration a position falls in, and again to match a definition to its
outline entry. The outline is now requested once — a position target's request
joins the wave it already waits on, so it costs no extra round trip — and the two
follow-up questions are answered from it. Only a definition in a _different_ file
still reaches across, which is the one case the answer is not already in hand.

`references` no longer asks for hover. The `Query:` line it produced could never
work: it took the first line of the hover's markdown, which for a TypeScript
symbol is the opening code fence, so the line rendered as ` ```typescript `
in every answer it has ever given. Both the line and its round trip are gone;
`Scope:` already names the anchoring project, and the caller supplied the
position.

`type_definitions`, `implementations`, `callers`, `callees`, and
`document_highlights` now go through `@type-atlas/core` rather than sending
protocol requests from the tool body. The two call-hierarchy tools each carried
their own prepare-then-fan-out; that shape is declared once in core and the tools
became assembly, which is what every other tool here already is.

`showTypeDefinitions` leaves `InspectSymbolResult`. Type definitions are only
fetched when the caller asks for them, so the flag could never reveal anything
the section did not already have.
