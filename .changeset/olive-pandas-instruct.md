---
"@type-atlas/mcp": minor
---

Ship server-level usage instructions and trim server metadata.

The server now sends MCP `instructions` describing one-based coordinates, the
role of `workspace` in selecting a language-server session, `inspect_symbol` as
the default entry point for understanding a symbol, the project boundary that
bounds reference results, and the semantic-not-textual nature of the retrieval
tools. Tool descriptions for `search_code`, `references`, and the `workspace`
input carry the same corrections, so agents stop treating scoped reference
results as complete usage audits and stop using semantic search for exact
strings.

The server icon is now referenced by URL rather than embedded as a `data:` URI,
which drops the advertised metadata from roughly 7.9 kB to under 400 bytes on
every initialize. Clients that cannot fetch the icon render none.
