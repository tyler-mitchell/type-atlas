# `@type-atlas/language-server`

The Volar-based language server used by Type Atlas. It configures TypeScript,
Markdown, and JSON language services and exposes the protocol consumed by
`@type-atlas/core`.

Most users should install the
[Type Atlas MCP server](https://github.com/tyler-mitchell/type-atlas#install).
This package is intended for integrations that need the underlying language
server process or protocol directly.

## Effect language service

Type Atlas activates `@effect/language-service` for TypeScript projects that
install and configure it according to the upstream package instructions:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@effect/language-service" }],
  },
}
```

No Type Atlas setting is required. Projects without that explicit plugin entry
use the standard Volar TypeScript service without loading Effect tooling.
