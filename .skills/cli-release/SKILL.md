---
name: cli-release
description: Release the Type Atlas npm package suite and MCP Registry record through Changesets and GitHub OIDC. Use when finalizing a public package change, preparing or reviewing a version pull request, publishing a release, verifying published artifacts, or recovering an interrupted Type Atlas release.
---

# Release Type Atlas

Release `@type-atlas/core`, `@type-atlas/language-server`, and `@type-atlas/mcp`
as one fixed-version package suite. Keep versions, changelogs, tags, and npm
publication under Changesets ownership.

## Interpret the request

- `commit` means finalize the in-scope source change, add its Changeset when
  consumer-visible, stage the intended commit, run `pnpm check:changeset`, and
  commit. Do not push or publish unless requested.
- `push` means push the prepared commit. Allow the version pull request to be
  created or updated, but do not merge it unless release was requested.
- `release` means carry the prepared change through the version pull request,
  npm publication, MCP Registry publication, and public verification.

## Read the release state first

Run:

```sh
pnpm release:status
```

It reports the working version, pending changesets, the published npm version of
every package, and the MCP Registry version, then names the state. Start here
for any release request, and again before concluding one. The suite publishes as
one fixed-version group, so any disagreement between those sources is an
interrupted release rather than normal drift.

## Never move the working tree

The working tree is shared. Another agent may be editing it, so a release must
not change the checked-out branch, and must not leave the repository on a branch
it did not start on.

Every step after a changeset reaches `main` is remote: creating and merging pull
requests, watching CI, and reading npm and the Registry. None of it requires a
local checkout.

- Do not `git checkout` or `git switch` to release.
- Do not pass `--delete-branch` to `gh pr merge`. It rewrites the local
  checkout, and on a rebase merge it leaves the repository on a stale `main`
  while reporting `fatal: Not possible to fast-forward`, which reads as a failed
  merge that in fact succeeded. Delete the remote branch directly instead:

  ```sh
  gh api -X DELETE repos/tyler-mitchell/type-atlas/git/refs/heads/<branch>
  ```

- When a release genuinely needs new commits, author them in a worktree so the
  primary checkout keeps its branch and its uncommitted work:

  ```sh
  git worktree add -b <branch> <path> origin/main
  git worktree remove <path>
  ```

- After merging, sync the local repository without checking anything out:

  ```sh
  git fetch origin
  ```

## Confirm the version before merging

`changeset version` promotes a `major` on a `0.x` package straight to `1.0.0`,
not to `0.2.0`. Read the version the pull request actually produces rather than
predicting it, and confirm that a first stable release is intended before
merging. Versions cannot be unpublished.

## Record a releasable change

Run:

```sh
pnpm changeset
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

`pnpm check:changeset` compares against `origin/main`, so it reports the
packages a branch changes and whether a changeset covers them. Fetch first when
the comparison must reflect the current remote.

Before merging, run:

```sh
pnpm install --frozen-lockfile
pnpm release:preflight
```

Do not edit package versions or changelogs manually. The fixed Changesets group
keeps all three packages on the same version even when a change directly names
only one package.

## Publish through the release pull request

After a changeset reaches `main`, `.github/workflows/release.yml` creates or
updates the Changesets version pull request.

GitHub may hold the first CI run from the bot-authored version pull request for
maintainer approval. If the run reports `action_required` without creating any
jobs, approve it, then wait for CI:

```sh
gh api --method POST repos/tyler-mitchell/type-atlas/actions/runs/<run-id>/approve
```

This is an approval gate, not a failed check.

Review that pull request for:

- the intended unified version;
- accurate changelog entries;
- updated internal dependency versions;
- the expected lockfile changes;
- removal of the consumed changeset files.

Merging the version pull request makes the same workflow run `pnpm release`,
which validates the repository and packed consumer experience before publishing
the packages in dependency order. After npm succeeds, the workflow authenticates
to the MCP Registry with GitHub OIDC and publishes the version-matched
`server.json`. Do not publish packages individually, publish Registry metadata
before npm, or create release tags manually.

## Verify the release

Confirm that npm and the Registry agree on one version for the complete suite:

```sh
pnpm release:status
```

A `released and consistent` state is the check. Any other state names the
defect, and `interrupted release — the MCP Registry is behind npm` means npm
published but Registry publication did not, which the workflow only attempts
when Changesets reports `published == 'true'`.

Confirm that a clean consumer can resolve the CLI:

```sh
npx --yes @type-atlas/mcp@latest --help
```

Confirm that the MCP Registry exposes the same release under
`io.github.tyler-mitchell/type-atlas`. A missing Registry entry after successful
npm publication is an interrupted release; manually dispatch the `Release`
workflow from the version commit after correcting Registry authentication or
metadata.

Treat a partial suite publication as an interrupted release. Correct the
publishing configuration, then manually dispatch the `Release` workflow from
the exact commit containing the version changes. Changesets skips versions
already present on npm and publishes only the missing packages.

Never overwrite or unpublish an established release to correct application
behavior. Publish a follow-up patch changeset instead.

## One-time publisher setup

Complete these owner-controlled requirements before the first automated
release:

1. Own or create the `type-atlas` organization on npm and confirm the release
   maintainer can publish public packages under the `@type-atlas` scope.
2. Make `tyler-mitchell/type-atlas` public and ensure every package
   `repository.url` exactly matches it.
3. Confirm that the Apache-2.0 license is present in every packed package.

npm cannot configure a trusted publisher until a package exists. Bootstrap
the package names with the verified `0.0.0` suite rather than publishing empty
placeholder packages:

```sh
npm login
pnpm install --frozen-lockfile
pnpm check:distribution
pnpm --recursive publish --access public
```

Configure each package's GitHub Actions trusted publisher with npm's supported
CLI. Use a current npm release under a supported Node LTS rather than delegating
this routine setup to the npm website:

```sh
npx --yes --package=node@24 --package=npm@latest -c 'npm trust github @type-atlas/language-server --file release.yml --repository tyler-mitchell/type-atlas --allow-publish --yes'
npx --yes --package=node@24 --package=npm@latest -c 'npm trust github @type-atlas/core --file release.yml --repository tyler-mitchell/type-atlas --allow-publish --yes'
npx --yes --package=node@24 --package=npm@latest -c 'npm trust github @type-atlas/mcp --file release.yml --repository tyler-mitchell/type-atlas --allow-publish --yes'
```

The first settings mutation may require a one-time npm browser approval. Select
npm's short-lived option to skip repeated challenges and run all three commands
inside that authenticated window. Each command's successful creation response
is the setup evidence; the first automated OIDC publication is the end-to-end
verification. Do not invoke `npm trust list` as routine verification because npm
requires another proof-of-presence challenge for that settings read.

After one successful OIDC release, require two-factor authentication and
disallow token-based publication for every package.

The release workflow must retain `id-token: write`, use a GitHub-hosted runner,
and install npm 11.5.1 or newer. The MCP Registry publisher also uses GitHub
OIDC and requires no repository secret. Do not add a long-lived npm or MCP
Registry publication token.
