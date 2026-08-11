---
"@type-atlas/core": patch
"@type-atlas/mcp": patch
---

Return document links an agent can act on. Markdown links pointing at a
directory, or at a file with a fragment, were resolved into VS Code command
URIs such as
`command:revealInExplorer?[{"$mid":1,"fsPath":"…","external":"file:///…"}]` —
editor-host instructions that mean nothing outside a VS Code window and cost
roughly 240 characters each.

The resource is now recovered from the command payload, so a link to
`packages/mcp` renders as `packages/mcp`. `document_links` on this repository's
README drops from 1,279 to 515 characters with all nine links intact. A command
target whose resource cannot be recovered is omitted, since an agent has no host
on which to run it.

`vscode-markdown-languageservice` hardcodes these command URIs with no option to
suppress them, and its plain-target `resolveLinkTarget` API is not surfaced by
`volar-service-markdown`, so the encoding is reversed on the returned links.
