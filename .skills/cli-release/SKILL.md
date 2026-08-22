---
name: cli-release
description: Release the Type Atlas npm package suite and MCP Registry record through Changesets and GitHub OIDC. Use when finalizing a public package change, preparing or reviewing a version pull request, publishing a release, verifying published artifacts, or recovering an interrupted Type Atlas release.
---

# Release Type Atlas

Release `@type-atlas/core`, `@type-atlas/language-server`, `@type-atlas/mcp`,
and `@type-atlas/atlascii` as one fixed-version package suite. Keep versions, changelogs,
tags, and npm publication under Changesets ownership.

`@type-atlas/atlascii` joined the suite after the others were already on npm.
It counts: `@type-atlas/core` and `@type-atlas/mcp` depend on it, so an install
of either resolves it from the registry.

This process is complete. Follow it; do not extend it. Adding a gate, a
verification step, a script, or a task — or rewriting this document to match a
theory about the registry — is out of scope for every release.

When something fails, the cause is in a package or its manifest, and the first
thing to read is the failing package's own `package.json` against the
requirements below.
`repository.url` must match this repository exactly, because npm matches
trusted publishing on it and answers `E404` when it is absent — which reads
like a missing package and is a missing field.

The owner runs one command, once, for a new package:
`vp run release:publish-and-trust-new-package <package-directory>`. Never ask them for another,
never ask them to log in, and never ask them to publish. If an earlier turn
already did, correct it plainly.

## Interpret the request

- `commit` means finalize the in-scope source change, add its Changeset when
  consumer-visible, stage the intended commit, run `vp run release:check-changeset`, and
  commit. Do not push or publish unless requested.
- `push` means push the prepared commit. Allow the version pull request to be
  created or updated, but do not merge it unless release was requested.
- `release` means carry the prepared change through the version pull request,
  npm publication, MCP Registry publication, and public verification.

## Preserve the working tree

The checkout is shared. Release tasks operate remotely after push; never switch
the checkout, delete the Changesets branch, or disturb uncommitted work.

## Confirm the version before merging

`changeset version` promotes a `major` on a `0.x` package straight to `1.0.0`,
not to `0.2.0`. Read the version the pull request actually produces rather than
predicting it, and confirm that a first stable release is intended before
merging. Versions cannot be unpublished.

## Record a releasable change

Run:

```sh
vp run release:changeset
```

Select every package whose public behavior changed and choose the appropriate
SemVer impact. Write the summary for package consumers. Commit the generated
`.changeset/*.md` file with the implementation.

A change is releasable when it can alter a package's API, MCP tool contract,
runtime behavior, output, dependencies, executable, metadata, packed contents,
installation, or update experience. Record the Changeset before declaring the
implementation complete; do not defer it to the version pull request.

Do not add a changeset for repository-only maintenance that cannot affect a
published package.

`vp run release:check-changeset` compares against `origin/main`, so it reports the
packages a branch changes and whether a changeset covers them. Fetch first when
the comparison must reflect the current remote.

Before merging, run:

```sh
vp run release:check
```

Do not edit package versions or changelogs manually. The fixed Changesets group
keeps all four packages on the same version even when a change directly names
only one package.

## Publish through the release pull request

After a changeset reaches `main`, `.github/workflows/release.yml` creates or
updates the Changesets version pull request.

```sh
vp run release:pr
```

Review that pull request for:

- the intended unified version;
- accurate changelog entries;
- updated internal dependency versions;
- the expected lockfile changes;
- removal of the consumed changeset files.

Merge the version pull request:

```sh
vp run release:merge
```

Merging the version pull request makes the same workflow run
`vp run release:publish`,
which validates the repository and packed consumer experience before publishing
the packages in dependency order. After npm succeeds, the workflow authenticates
to the MCP Registry with GitHub OIDC and publishes the version-matched
`server.json`. Do not publish packages individually, publish Registry metadata
before npm, or create release tags manually.

## Verify the release

The Release workflow is the release record. Completion requires its npm
publication and MCP Registry publication steps to succeed. The agent reads and
resolves any failed workflow step; the user runs no release command.

```sh
vp run release:run
vp run release:watch <run-id>
vp run release:verify
```

If the workflow fails, read the failed step through the named task:

```sh
vp run release:failure <run-id>
```

Confirm that the MCP Registry exposes the same release under
`io.github.tyler-mitchell/type-atlas`. A missing Registry entry after successful
npm publication is an interrupted release. The agent corrects the cause and
runs the recovery task:

```sh
vp run release:recover
```

Treat a partial suite publication as an interrupted release. Correct the
publishing configuration, then run `vp run release:recover`. Changesets skips
versions already present on npm and publishes only the missing packages.

Never overwrite or unpublish an established release to correct application
behavior. Publish a follow-up patch changeset instead.

## When the suite gains a public package

Zero-interaction releases cover package names whose trusted publisher already
exists. At the start of a release, inspect the package graph for a new public
npm name. When one exists, respond immediately with exactly:

```sh
vp run release:publish-and-trust-new-package <package-directory>
```

Wait for its result before continuing. Give no second command. The command
validates the public manifest, runs typecheck and tests, publishes through the
package's prepack build, then configures trust. The owner approves 2FA once and selects
npm's five-minute skip option. After success, GitHub OIDC owns every future
publication for that name and the agent runs every remaining release task.

Publish and configure trust before merging the version pull request. The package manifest must
declare its name, version, Type Atlas repository, public access, and build,
check-types, test, and prepack tasks. Its directory must be listed in
`pnpm-workspace.yaml`, its name must be in the Changesets fixed group, and
`@type-atlas/mcp` must already declare its workspace dependency.
`release:publish-and-trust-new-package` validates all three before publishing.

**Never use raw `npm publish` to get moving.** It does
not understand pnpm's workspace protocols: it uploads `catalog:` and
`workspace:*` verbatim, and the result installs nowhere —
`EUNSUPPORTEDPROTOCOL: Unsupported URL Type "catalog:"`. pnpm rewrites those
specifiers at publish time. The normal workflow and `release:publish-and-trust-new-package` are the
only sanctioned publishers.

The publish-and-trust command's successful completion is the setup evidence; the
first automated OIDC publication is the end-to-end verification. Do not invoke
`npm trust list` as routine verification because npm requires another
proof-of-presence challenge for that settings read.

The release workflow must retain `id-token: write`, use a GitHub-hosted runner,
and install npm 11.5.1 or newer. The MCP Registry publisher also uses GitHub
OIDC and requires no repository secret. Do not add a long-lived npm or MCP
Registry publication token.
