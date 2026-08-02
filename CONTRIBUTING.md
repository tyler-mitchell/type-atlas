# Contributing

Type Atlas is a pnpm workspace and requires Node.js 22.20 or newer.

```sh
pnpm install
pnpm check
```

## Record public changes

Every change that alters a published package's behavior, API, MCP tool surface,
output, metadata, executable, dependencies, or installation must include a
Changeset in the same pull request:

```sh
pnpm changeset
```

Select each affected package, choose the SemVer impact, and write the summary
for package consumers. Use `patch` for compatible fixes, `minor` for compatible
capabilities, and `major` for incompatible public changes. The package suite is
versioned as a fixed group, so Changesets keeps its published versions aligned.

Repository-only maintenance that cannot affect packed artifacts or consumers
does not require a Changeset. Do not use that exemption for tests or build
changes that expose a release defect.

Before committing, stage the intended commit and verify it with Changesets'
native comparison:

```sh
pnpm check:changeset
```

This fails when a public package changed without a Changeset. For package-local
work that intentionally has no release impact, record that decision with
`pnpm changeset add --empty`.

Before a change is ready for review:

```sh
pnpm check
pnpm changeset status
```

Do not edit package versions or changelogs manually.

## Releases

A commit or push request does not authorize publication. An explicit release
request carries the prepared change through the version pull request and public
verification.

Changesets opens a version pull request after unreleased Changesets reach
`main`. Merging that pull request publishes the fixed package suite to npm with
GitHub OIDC, then publishes the matching `server.json` to the official MCP
Registry. Maintainers should follow [the release runbook](.skills/cli-release/SKILL.md)
for first-publication setup, verification, and recovery.
