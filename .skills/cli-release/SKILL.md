---
name: release-package
description: Record and release Type Atlas package changes through the repository's local Bumpy workflow.
---

# Release packages

The root `AGENTS.md` owns branch, commit, push, and synchronization behavior.

For a consumer-visible package change, follow `.skills/add-change/SKILL.md` and
commit its bump file with the implementation on `main`. Pushing `main` makes
Bumpy create or update `bumpy/version-packages`; it does not publish.

An explicit release request authorizes:

```sh
vp run release:merge
```

The command enables auto-merge; required checks gate the merge. Return to useful
work. GitHub owns publication and public verification. Inspect the workflow only
when GitHub reports failure. Never version, publish, dispatch, or poll locally.
