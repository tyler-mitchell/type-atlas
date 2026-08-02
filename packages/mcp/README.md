# `@type-atlas/mcp`

The Type Atlas MCP server gives coding agents editor-grade TypeScript,
Markdown, and JSON intelligence over stdio.

```sh
codex mcp add type-atlas -- npx --yes @type-atlas/mcp@latest
```

Use `@latest` to receive new releases the next time the MCP process starts.
Replace it with an exact published version when reproducible tool behavior is
more important than automatic updates.

For Claude Code, VS Code, native Windows, and generic MCP client setup, see the
[Type Atlas installation guide](https://github.com/tyler-mitchell/type-atlas#install).

Requires Node.js 22.20 or newer. The `type-atlas` executable writes MCP protocol
messages to stdout and operational errors to stderr.
