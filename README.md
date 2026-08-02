# Type Atlas

Type Atlas gives coding agents editor-grade TypeScript, Markdown, and JSON
navigation through the Model Context Protocol. It runs locally over stdio and
uses the TypeScript project selected for each file, so definitions, references,
diagnostics, code actions, and source ranges reflect the repository an agent is
actually changing.

## Install

Type Atlas requires Node.js 22.20 or newer. No global package installation is
required.

### Codex

```sh
codex mcp add type-atlas -- npx --yes @type-atlas/mcp@latest
```

### Claude Code

```sh
claude mcp add --scope user type-atlas -- npx --yes @type-atlas/mcp@latest
```

### VS Code

```sh
code --add-mcp '{"name":"type-atlas","command":"npx","args":["--yes","@type-atlas/mcp@latest"]}'
```

### Other MCP clients

```json
{
  "mcpServers": {
    "type-atlas": {
      "command": "npx",
      "args": ["--yes", "@type-atlas/mcp@latest"]
    }
  }
}
```

### Native Windows

Clients that cannot launch the `npx.cmd` shim directly should invoke it through
`cmd`:

```powershell
codex mcp add type-atlas -- cmd /c npx --yes @type-atlas/mcp@latest
claude mcp add --scope user type-atlas -- cmd /c npx --yes @type-atlas/mcp@latest
```

For JSON configuration, use `"command": "cmd"` and
`"args": ["/c", "npx", "--yes", "@type-atlas/mcp@latest"]`.

Restart the MCP server after changing its configuration. Configurations using
`@latest` start the current npm release; pin an exact version when reproducible
tool behavior is more important than automatic upgrades.

## What agents can do

Type Atlas exposes focused tools for:

- folded and ranged reads across source, Markdown, and JSON files;
- document and workspace symbol navigation;
- definitions, implementations, references, callers, callees, hovers, and
  signature help;
- diagnostics, code actions, formatting, imports, symbol renames, and file
  renames as reviewable patches;
- package export and dependency-source exploration;
- bounded workspace structure and behavior-oriented code retrieval.

Token-expanding detail remains opt-in where practical, and tool responses use
workspace-relative paths so their locations can be applied directly.

## Packages

- [`@type-atlas/mcp`](packages/mcp) is the installable MCP server.
- [`@type-atlas/core`](packages/core) is the headless code-intelligence API.
- [`@type-atlas/language-server`](packages/language-server) is the Volar-based
  language server used by the core package.

## Development

```sh
pnpm install
pnpm check
pnpm check:distribution
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the change and release process.

## License

Apache-2.0
