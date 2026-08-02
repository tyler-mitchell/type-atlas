# MCP distribution reference research

Retrieved: 2026-07-30; primary contracts revalidated 2026-08-02

## Objective

Choose one primary open-source reference for distributing Type Atlas as a local
MCP server across Codex, Claude Code, VS Code, and other MCP clients. The target
experience is one install command, copyable client configuration, predictable
updates, cross-platform execution, and a release path maintainers can trust.

This research evaluates actual repository source, package metadata, release
automation, and documented client commands. Remote hosted MCP deployment and
OAuth are relevant comparison points, but are not substitutes for Type Atlas's
required access to a user's local working tree.

## Decision criteria

1. Frictionless first run without a repository clone or global installation.
2. Correct stdio process lifetime and argument forwarding on macOS, Linux, and
   Windows.
3. Explicit setup for several major MCP clients without client-specific runtime
   forks.
4. Reproducible package contents, provenance, releases, and upgrade behavior.
5. High-signal documentation that keeps the canonical command identical across
   clients.
6. Optional ecosystem conveniences that do not become required infrastructure.

## Candidate coverage

| Candidate                      | Why examine it                                                        | Status                   |
| ------------------------------ | --------------------------------------------------------------------- | ------------------------ |
| Microsoft Playwright MCP       | Mature local stdio server with broad client setup                     | Reviewed                 |
| Chrome DevTools MCP            | Modern official npm-distributed local MCP                             | Reviewed                 |
| Context7                       | Popular npm MCP with local and hosted installation paths              | Reviewed                 |
| GitHub MCP Server              | Polished multi-client distribution with binary/container/remote modes | Reviewed; not comparable |
| Sentry MCP                     | Strong hosted install and client onboarding                           | Reviewed; not comparable |
| Official MCP Registry and MCPB | Canonical discovery and bundle formats                                | Reviewed                 |

## Current synthesis

Chrome DevTools MCP is the best primary reference. It has the most complete
combination of a canonical npm command, package-content verification, npm
provenance, MCP Registry publication, immutable workflow dependencies,
cross-platform notes, update behavior, and client-native install paths.

It is a reference, not an implementation to copy verbatim. Its current Claude
Code command does not follow Claude's documented option ordering and `--`
separator, demonstrating why Type Atlas must derive client snippets from the
clients' current native interfaces rather than treating another MCP README as
authoritative.

Playwright MCP is the best secondary reference for the smallest clean Registry
publication workflow. Context7 supplies a valuable one-command setup idea, but
its direct JSON/TOML config rewriting is too broad and brittle to adopt.

## Microsoft Playwright MCP

Observed at `microsoft/playwright-mcp` main on 2026-07-30:

- `package.json` exposes `@playwright/mcp` through one `playwright-mcp` npm
  binary and declares the MCP Registry identity with `mcpName`.
- The canonical runtime is `npx @playwright/mcp@latest`. Codex and Claude Code
  receive short native registration commands; VS Code and Cursor also receive
  install links. Every path starts the same npm binary.
- `server.json` declares the npm package and stdio transport using the official
  MCP Registry schema.
- Release automation tests before publishing, uses npm OIDC trusted publishing,
  verifies registry/package version parity, and publishes the registry entry
  with GitHub OIDC.
- The README separates the standard config from client-specific details, but
  its large client matrix is difficult to maintain and not itself evidence that
  each path is continuously exercised.

Type Atlas consequence: adopt the npm binary + `mcpName` + `server.json` +
OIDC/Registry publication spine. Use fewer, generated client examples rather
than copying Playwright's long handwritten matrix.

Evidence:

- <https://github.com/microsoft/playwright-mcp/blob/main/package.json>
- <https://github.com/microsoft/playwright-mcp/blob/main/README.md>
- <https://github.com/microsoft/playwright-mcp/blob/main/server.json>
- <https://github.com/microsoft/playwright-mcp/blob/main/.github/workflows/publish.yml>

## Chrome DevTools MCP

Observed at `ChromeDevTools/chrome-devtools-mcp` main on 2026-07-30:

- The standard config is unambiguous:
  `npx -y chrome-devtools-mcp@latest`. The explicit `-y` avoids an interactive
  npm prompt when a client starts the server unattended.
- It combines the same npm `bin`, `mcpName`, and MCP Registry `server.json`
  spine as Playwright with stronger package-release safeguards.
- The tag-triggered release bundles production output, publishes with npm
  provenance and OIDC, then publishes the MCP Registry record with GitHub OIDC.
  Third-party GitHub Actions are pinned to immutable commit SHAs.
- `npm publish --dry-run --json` is used to assert that required runtime files
  are actually present in the tarball.
- The README gives native Codex and Claude commands, install links where clients
  support them, explicit Windows guidance, upgrade behavior, requirements,
  privacy behavior, and troubleshooting.
- Generated tool/CLI documentation and release-please reduce recurring release
  maintenance. The product also offers an ordinary CLI, but that is a product
  capability rather than a prerequisite for MCP installation.

Type Atlas consequence: Chrome DevTools MCP is the stronger primary reference
for installation polish and package integrity. Playwright remains the cleaner
reference for the minimal registry publication shape.

Evidence:

- <https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/package.json>
- <https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/README.md>
- <https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/server.json>
- <https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/.github/workflows/publish-to-npm-on-tag.yml>
- <https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/scripts/verify-npm-package.mjs>

## Context7

Observed at `upstash/context7` master on 2026-07-30:

- `npx ctx7 setup` is the strongest first-run experience examined so far. It
  detects supported agents, offers project/global scope, installs or removes
  integration artifacts, and gives users a single product command instead of a
  client-configuration tutorial.
- The MCP package still has the expected independent npm binary and `mcpName`.
  Context7 additionally ships an MCPB bundle and a hosted MCP endpoint.
- The setup implementation directly discovers and rewrites several clients'
  JSON, JSON-with-comments, and TOML configuration files. It contains custom
  comment stripping and TOML section parsing. This creates a broad maintenance
  and data-preservation boundary and should not be copied when Codex, Claude,
  and other clients already provide native MCP registration commands.
- Context7's hosted transport and authentication materially simplify its own
  setup, but Type Atlas must run locally to observe the working tree. Hosted
  installation is therefore not a comparable primary path.

Type Atlas consequence: adopt the one-command setup concept, target detection,
scope selection, idempotent remove/doctor experience, and MCPB only where a
supporting client makes it valuable. Implement registration through each
client's supported CLI or install link; do not copy Context7's custom config
parsers.

Evidence:

- <https://github.com/upstash/context7/blob/master/README.md>
- <https://github.com/upstash/context7/blob/master/packages/mcp/package.json>
- <https://github.com/upstash/context7/blob/master/packages/cli/package.json>
- <https://github.com/upstash/context7/blob/master/packages/cli/src/setup/agents.ts>
- <https://github.com/upstash/context7/blob/master/packages/cli/src/setup/mcp-writer.ts>

## Official distribution formats

Observed from the MCP Registry quickstart, Registry repository, MCPB repository,
and official example servers on 2026-07-30:

- The MCP Registry is metadata discovery, not package hosting. An npm MCP should
  publish its executable package first, declare the same `mcpName` in
  `package.json` and `name` in `server.json`, then publish the registry metadata
  with `mcp-publisher`.
- The official TypeScript server convention is
  `npx -y <package>`. Official Windows examples use
  `cmd /c npx -y <package>` where the MCP host cannot launch the npm command
  shim directly.
- MCPB is the one-click local bundle format. It can carry a Node server,
  dependencies, configuration fields, icons, and update metadata. Claude
  Desktop supports it on macOS and Windows, but Codex and Claude Code do not
  use it as their universal MCP installation path.

Type Atlas consequence: npm + MCP Registry is the universal base. MCPB is a
useful additional release artifact for supporting desktop clients, but must not
replace the npm package or be required by the setup flow.

Evidence:

- <https://modelcontextprotocol.io/registry/quickstart>
- <https://github.com/modelcontextprotocol/registry>
- <https://github.com/modelcontextprotocol/mcpb>
- <https://github.com/modelcontextprotocol/servers/blob/main/README.md>

## Non-comparable polished references

GitHub MCP Server has excellent per-client guides and one-click setup, but its
local path requires Docker or a downloaded Go binary and authentication. Sentry
MCP makes a hosted OAuth endpoint the preferred path and treats local stdio as
a self-hosting path. Both are useful documentation references but would lead
Type Atlas away from its actual local npm runtime.

Evidence:

- <https://github.com/github/github-mcp-server>
- <https://github.com/getsentry/sentry-mcp>

## Current client-native installation contracts

Verified against current client documentation and source on 2026-07-30:

- Canonical runtime command:
  `npx -y @type-atlas/mcp@latest`.
- Codex:
  `codex mcp add type-atlas -- npx -y @type-atlas/mcp@latest`.
  Codex's current CLI source declares the stdio form as
  `codex mcp add [OPTIONS] <NAME> -- <COMMAND>...`.
- Claude Code, user scope:
  `claude mcp add --scope user type-atlas -- npx -y @type-atlas/mcp@latest`.
  Claude documents that all options precede the server name and `--` separates
  the executable and its arguments.
- VS Code:
  `code --add-mcp '{"name":"type-atlas","command":"npx","args":["-y","@type-atlas/mcp@latest"]}'`.
  Publishing to the MCP Registry also makes gallery-based discovery possible
  for clients that consume the Registry.
- Other stdio clients receive the same command and arguments through their
  native installer, install link, or standard configuration shape.
- On Windows, clients that cannot launch npm's command shim directly should use
  `cmd /c npx -y @type-atlas/mcp@latest`. This is a host registration concern,
  not a separate Type Atlas runtime.

Evidence:

- <https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs>
- <https://code.claude.com/docs/en/mcp>
- <https://code.visualstudio.com/docs/agent-customization/mcp-servers>

## Implemented distribution contract

| Build need                   | Owning artifact                                       | Contract                                                                 | Status         |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ | -------------- |
| Executable package           | `packages/mcp/package.json`                           | `@type-atlas/mcp` exposes `type-atlas`; packed files are allowlisted     | runtime-proven |
| Registry discovery           | `server.json`                                         | `io.github.tyler-mitchell/type-atlas` resolves to the npm stdio package  | runtime-proven |
| Version identity             | `scripts/sync-server-manifest.ts`                     | Changesets versions the suite; the version command synchronizes Registry | runtime-proven |
| Packed consumer verification | `packages/mcp/scripts/verify-distribution.ts`         | pack all packages, install them cleanly, run the CLI, list MCP tools     | runtime-proven |
| Cross-platform verification  | `.github/workflows/ci.yml`                            | the packed consumer path runs on Linux, macOS, and Windows               | generated      |
| Secure publication           | `.github/workflows/release.yml`                       | npm publishes with OIDC before Registry publication with GitHub OIDC     | generated      |
| Consumer setup               | `README.md` and `packages/mcp/README.md`              | native client commands resolve to the same npm executable                | observed       |
| Change discipline            | `AGENTS.md`, `CONTRIBUTING.md`, `.skills/cli-release` | public changes carry Changesets; generated versions are not hand-edited  | observed       |

The local verification command exercises the distributed artifact rather than
the workspace entrypoint:

```sh
pnpm check:distribution
```

```text
Packed packages install cleanly and expose the Type Atlas MCP.
```

A custom `type-atlas setup` command is not justified for the first release.
Codex, Claude Code, and VS Code already own their configuration formats and
provide native registration commands. If direct usage later shows that client
selection is still a real barrier, a setup command may orchestrate those native
registrars; it should never parse and rewrite their config files itself.

MCPB is also not part of the universal first-release path. It is worthwhile only
as an additional Claude Desktop artifact after npm and Registry installation
are complete.

## Decision

Use `ChromeDevTools/chrome-devtools-mcp` as the primary distribution reference.
Borrow Playwright MCP's minimal Registry automation where it is simpler. Keep
Type Atlas's existing Changesets release ownership rather than adopting
release-please, because changelog orchestration and MCP distribution are
separate concerns and the current package suite already releases together.

The desired user experience is:

```sh
# Codex
codex mcp add type-atlas -- npx -y @type-atlas/mcp@latest

# Claude Code
claude mcp add --scope user type-atlas -- npx -y @type-atlas/mcp@latest
```

Every other supported client should resolve to the same npm executable. There
should be no global install requirement, repository clone, TypeScript SDK
configuration, generated config file, wrapper process, or client-specific
Type Atlas build.
