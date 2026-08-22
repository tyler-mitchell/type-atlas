# Contributing

Type Atlas is a Vite+ workspace and requires Node.js 22.20 or newer.

```sh
vp install
vp run check
```

## Record public changes

Every change that alters a published package's behavior, API, MCP tool surface,
output, metadata, executable, dependencies, or installation must include a
Bumpy bump file in the same pull request:

```sh
vp run release add
```

Select each affected package, choose the SemVer impact, and write the summary
for package consumers. Use `patch` for compatible fixes, `minor` for compatible
capabilities, and `major` for incompatible public changes. The package suite is
versioned as a fixed group, so Bumpy keeps its published versions aligned.

Repository-only maintenance that cannot affect packed artifacts or consumers
does not require a bump file. Do not use that exemption for build
changes that expose a release defect.

Bumpy cannot infer a package from files above its directory. A root
`vite.config.ts` pack-contract change must name every affected package;
`server.template.json` and `scripts/prepare-registry-manifest.ts` changes must
name `@type-atlas/mcp`.

Before committing, verify that every changed package is covered:

```sh
vp run release check --strict
```

For package-local work that intentionally has no release impact, record `none`.
For repository-only work, Bumpy requires no bump file.

Before a change is ready for review:

```sh
vp run check
vp run release status
```

Do not edit package versions or changelogs manually.

## Releases

A commit or push request does not authorize publication. An explicit release
request carries the prepared change through the version pull request and public
verification.

Bumpy maintains a version pull request after bump files reach `main`. Merging
that pull request publishes the fixed package suite to npm with GitHub OIDC and
creates the GitHub Releases. The MCP release then publishes its generated
manifest to the official MCP Registry and verifies the anonymous production
server. See the bundled [Bumpy change skill](.skills/add-change/SKILL.md).
