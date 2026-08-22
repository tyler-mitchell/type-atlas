---
name: cli-release
description: Release the Type Atlas npm package suite and MCP Registry record through Changesets and GitHub OIDC. Use when finalizing a public package change, preparing or reviewing a version pull request, publishing a release, verifying published artifacts, or recovering an interrupted Type Atlas release.
---

# Release Type Atlas

Release `@type-atlas/atlascii`, `@type-atlas/core`,
`@type-atlas/language-server`, and `@type-atlas/mcp` as one fixed-version
suite. Changesets owns versions, changelogs, dependency versions, tags, and npm
publication. GitHub OIDC owns npm and MCP Registry authentication.

Follow the sequence below exactly. Never invent a command, use raw `npm`, or
infer external state from a terminal you do not own.

## Request authority

- `commit`: finalize the change, add its Changeset, run the gates, and commit.
  Do not push or publish.
- `push`: push the finalized commit. Do not merge the version pull request.
- `release`: complete every step below through public verification.

## Finalize the release commit

1. Add one accurate Changeset for every consumer-visible package change.
   Consumer-visible includes APIs, MCP tools, output, runtime behavior,
   dependencies, executables, metadata, packed contents, installation, and
   update behavior. Use `vp run release:changeset` when an interactive Changeset
   is useful. Never edit versions or changelogs.
2. Run `vp run release:check`.
3. Stage only the intended release change.
4. Run `vp run release:check-changeset`. The Changeset must be staged because
   this command compares the Git change against `origin/main`.
5. Commit with a Conventional Commit message.
6. Run `git pull --rebase` before any owner action or push. This places the
   release on the latest published suite version. Resolve conflicts by keeping
   current upstream versions and changelog history while retaining the intended
   implementation. Run `vp install` if manifests changed, rerun
   `vp run release:check`, and amend only files changed by that reconciliation.

The checkout is shared. Never switch branches, delete the Changesets branch,
discard unrelated work, or rewrite remote history.

## First publication of a new package name

Run this section only when npm has never published the package name. Existing
package names already have trusted publishers and require no owner action.

Before involving the owner, the package must:

- be public and carry complete npm metadata, repository identity, files,
  exports, and `build`, `check-types`, `test`, and `prepack` tasks;
- be listed in `pnpm-workspace.yaml`;
- be in the Changesets fixed group;
- be a workspace dependency of `@type-atlas/mcp` when the MCP consumes it;
- have passed the finalized, rebased release commit sequence above.

Send the owner exactly one command and wait:

```sh
vp run release:publish-and-trust-new-package <package-directory>
```

This performs the first pnpm publication and configures the GitHub trusted
publisher in one npm 2FA window. Never split it into publish and trust commands,
ask the owner to log in, or ask for another approval.

When the owner says it finished, verify the registry immediately. Do not inspect
the thread terminal or infer whether it ran:

```sh
vp run release:verify <package-name>@<manifest-version>
```

Continue only after that exact version installs anonymously. The owner never
runs this command again for the package.

## Push and create the version pull request

1. Run `git push`.
2. Run `vp run release:run` and copy the returned run ID.
3. Run `vp run release:watch <run-id>`.
4. Run `vp run release:pr` after the workflow creates the version pull request.
5. Confirm the intended fixed-suite version, changelog entries, dependency
   versions, lockfile changes, and consumed Changeset removal. A `major`
   Changeset on `0.x` produces `1.0.0`; never predict the version.
6. For a release request, run `vp run release:merge`.

## Publish and verify

1. Run `vp run release:run` and copy the new run ID.
2. Run `vp run release:watch <run-id>` through completion. The npm publication
   and MCP Registry publication steps must both succeed.
3. Run `git pull --rebase` to receive the version commit and tags.
4. Run `vp run release:verify`. Completion requires the anonymous
   `@type-atlas/mcp@latest` install to expose the captured tool catalog and serve
   a real source request through the official MCP client and stdio transport.

The successful Registry publication step verifies
`io.github.tyler-mitchell/type-atlas` at the same version as `server.json`.
Never publish packages individually, publish Registry metadata before npm,
create tags manually, or use a long-lived npm or Registry token.

## Failure recovery

Read a failed workflow only through:

```sh
vp run release:failure <run-id>
```

Correct the actual package, manifest, workflow, or Registry failure. For a
partial publication, run `vp run release:recover`; Changesets skips versions
already present on npm and publishes the missing packages. Never overwrite or
unpublish an established release. Ship a follow-up patch instead.
