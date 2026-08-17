---
"@type-atlas/mcp": patch
---

Start semble when this server starts, not on the first search.

Semble runs as its own process, and starting it is `uvx` resolving the package,
Python booting, and an MCP handshake — most of two seconds. The client connected
on first use, so the first search of a session wore all of it: 2,365ms for a
query that costs 349ms once the process is up.

The connection is opened when the server is created and awaited where it was
before, so it happens while the agent is reading files and a search arriving
later joins a connection already open. A failure is still reported at the search,
with the message that says how to install uvx. The first search of a server's
life is now 959ms.
