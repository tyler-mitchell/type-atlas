---
"@type-atlas/mcp": patch
---

Move the MCP client and server SDKs from `2.0.0-beta.5` to the stable `2.0.0`
release, so published builds no longer depend on a prerelease. Both protocol
eras stay served: `server/discover` answers modern `2026-07-28` clients with the
server's supported versions and instructions, and the legacy `initialize`
handshake continues to work for older clients.
