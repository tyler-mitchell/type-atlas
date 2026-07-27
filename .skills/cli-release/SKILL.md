---
name: cli-release
description: Release the Type Atlas npm package suite through Changesets and the GitHub Actions trusted-publishing workflow. Use when adding release notes, preparing or reviewing a version pull request, publishing a release, verifying published artifacts, or recovering an interrupted Type Atlas release.
---

# Release Type Atlas

Release `@typeatlas/core`, `@typeatlas/language-server`, and `@typeatlas/mcp`
as one fixed-version package suite. Keep versions, changelogs, tags, and npm
publication under Changesets ownership.

## Record a releasable change

Run:

```sh
pnpm changeset
```

Select every package whose public behavior changed and choose the appropriate
SemVer impact. Write the summary for package consumers. Commit the generated
`.changeset/*.md` file with the implementation.

Do not add a changeset for repository-only maintenance that cannot affect a
published package.

Before merging, run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm changeset status
```

Do not edit package versions or changelogs manually. The fixed Changesets group
keeps all three packages on the same version even when a change directly names
only one package.

## Publish through the release pull request

After a changeset reaches `main`, `.github/workflows/release.yml` creates or
updates the Changesets version pull request.

Review that pull request for:

- the intended unified version;
- accurate changelog entries;
- updated internal dependency versions;
- the expected lockfile changes;
- removal of the consumed changeset files.

Merge the version pull request. The same workflow then runs `pnpm release`,
which validates the repository and publishes the packages in dependency order.
Do not publish the packages individually or create release tags manually.

## Verify the release

Confirm that npm exposes the same version for the complete suite:

```sh
npm view @typeatlas/language-server version
npm view @typeatlas/core version
npm view @typeatlas/mcp version
```

Confirm that a clean consumer can resolve the CLI:

```sh
npx --yes @typeatlas/mcp@latest --help
```

Treat a partial suite publication as an interrupted release. Correct the
publishing configuration, then manually dispatch the `Release` workflow from
the exact commit containing the version changes. Changesets skips versions
already present on npm and publishes only the missing packages.

Never overwrite or unpublish an established release to correct application
behavior. Publish a follow-up patch changeset instead.

## One-time publisher setup

Complete these owner-controlled requirements before the first automated
release:

1. Make `tyler-mitchell/typeatlas` public and ensure every package
   `repository.url` exactly matches it.
2. Add the selected open-source license to the repository and package
   manifests.

npm cannot configure a trusted publisher until a package exists. Bootstrap
each name once from an empty directory outside this repository:

```sh
mkdir typeatlas-package-bootstrap
cd typeatlas-package-bootstrap
npm init --yes
npm pkg set name=@typeatlas/core version=0.0.0
npm publish --access public
npm pkg set name=@typeatlas/language-server
npm publish --access public
npm pkg set name=@typeatlas/mcp
npm publish --access public
cd ..
rm -rf typeatlas-package-bootstrap
```

Then configure a GitHub Actions trusted publisher in the npm package settings
for each package:

- owner: `tyler-mitchell`
- repository: `typeatlas`
- workflow: `release.yml`
- environment: leave empty
- allowed action: `npm publish`

After one successful OIDC release, require two-factor authentication and
disallow token-based publication for every package.

The release workflow must retain `id-token: write`, use a GitHub-hosted runner,
and install npm 11.5.1 or newer. Do not add a long-lived npm publication token.
