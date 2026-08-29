---
name: release-package
description: Record and release Type Atlas package changes through the repository's local Bumpy workflow.
---

# Release packages

The root `AGENTS.md` owns branch, commit, push, and synchronization behavior.

For a consumer-visible package change, follow `.skills/add-change/SKILL.md` and
commit its bump file with the implementation on `main`. Bump files accumulate
until the ordinary `main → release` pull request merges; that push makes Bumpy
create or update `bumpy/version-packages`.

Create the bump with the first consumer-visible commit for that logical change.
Update the same bump as the change evolves. Give unrelated logical changes
separate bump files. Commit implementation, tests, generated consumer docs,
and the bump together. Never wait for a release request to reconstruct bumps
from commit history.

An explicit release request authorizes this sequence:

```sh
vp run dependencies:list
vp run release:push
vp run release:promote:pr
vp run release:promote:create # only when no promotion pull request exists
vp run release:promote:merge
```

After GitHub reports the promotion merge, run:

```sh
vp run release:pr
vp run release:merge
```

Run `release:merge` only when `release:pr` returns the version pull request.
Required checks gate both merges. GitHub owns publication and public
verification. After publication, run `release:sync` and `release:sync:push` on
the clean `main` branch. Inspect a workflow only after failure. Never version,
publish, dispatch, or poll locally.
