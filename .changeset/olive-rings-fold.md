---
"@type-atlas/mcp": minor
"@type-atlas/core": minor
---

Answer syntactic questions without loading a TypeScript program, and report what
a call cost.

`read_file` asked the language server for folding ranges. Volar resolves a
request to the project owning the document before dispatching it, so folding a
file loaded that project's entire program — 4,782 ms for the first read of a
3,545-file project, against 22 ms for the same read with `fold: false`. Nothing
about folding needs a program: `volar-service-typescript` answers
`textDocument/foldingRange` by handing the document to a syntax-only TypeScript
service and converting its outlining spans.

That is now what runs, in this process, on text already read from disk —
`getLanguageServiceByDocument` and `convertOutliningSpan` from that same
package, so a folded view is byte-identical to what the server returned. The
same read is 8 ms. A read no longer touches the language server at all, and
costs what reading a file costs regardless of which project the file belongs to
or whether that project has ever been loaded.

Semantic search had the same problem, one result at a time. Labelling a match
with the symbol containing it asked the language server for that file's document
outline, and search answers from the whole search root, so a page of results
spanning four packages built four programs to label itself. Document symbols are
syntactic too — the same plugin provides them, from `getNavigationTree` over the
same syntax-only service — so `search_code`, `related_code`, and
`explore_symbol` now label their results from a parse. A five-result page
spanning three packages, none of them loaded, is 1.2 s and loads nothing, and
what remains in it is semble's own work in its own process.

`inspect_symbol` asked the same question three ways. Resolving a name wanted the
document's outline, finding what a position sits inside wanted it again, and
naming a definition wanted the outline of whichever file it landed in — three
requests, each of which could build a program, and the first of them ran before
anything else so a name target waited on a project just to find out which
declaration it meant. All three are parses now. What remains of the identity
question is two cases rather than five: a callable carries its own name and kind
from the call hierarchy, and anything else is the declaration its definition
points at, or the one it sits inside.

Finding that enclosing declaration also stopped flattening the outline, sorting
every declaration in the file by how tightly it wraps the position, and taking
the first. An outline is a tree, so it is one descent through the branch that
contains the position. `flattenSymbols` lost its `SymbolInformation` half, which
nothing can reach now that outlines are parsed here.

Three more things go with it. `serving()` leaves `VolarWorkspace`: it existed to keep
reads off a cold server, and answered the wrong question — it reported that
*some* request had been answered, while the cost is the program for *this file's*
project, so the first read in each new project paid it anyway. `readSource`
leaves `createTypeAtlas`, having had no callers since `read_file` was rewritten
around `readSourceView`. And the "language server was still starting" notice
leaves `read_file`, along with the `folded` flag that drove it, because folding
is no longer something a read can fail to get.

Every tool now reports its own elapsed time on the last line of its answer. A
cold project load and a warm lookup return the same text, and an agent choosing
what to ask next — whether to narrow a search, whether a package is already
loaded, whether a repeat is free — is choosing on exactly that difference.
