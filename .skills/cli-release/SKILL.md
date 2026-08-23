---
name: release-package
description: Record and release Type Atlas package changes through the repository's local Bumpy workflow.
---

# Release packages

For a consumer-visible package change, follow `.skills/add-change/SKILL.md` and
commit its bump file with the implementation.

An explicit release request authorizes one command after GitHub reports the
generated `bumpy/version-packages` pull request is green:

```sh
vp run release:merge
```

Return to useful work. GitHub owns publication and public verification. Inspect
the workflow only when GitHub reports failure. Never version, publish, dispatch,
or poll locally.
