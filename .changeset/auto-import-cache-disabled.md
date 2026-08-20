---
"@type-atlas/language-server": patch
"@type-atlas/mcp": patch
---

A language-server death mid-request could surface as a bare "Connection is disposed": the synthetic document's close notification threw from its cleanup and replaced the informative exit report. Crashes now surface with their cause and the server's last words, and unexpected tool errors log their stack to stderr. The `typescript-auto-import-cache` integration is disabled via `volar-service-typescript`'s own option — its project initialization was one trigger of a bridge defect that kills program rebuilds after an unowned document enters the host. `add_missing_imports` says honestly when names do not resolve and the engine proposed no fix, instead of "No missing imports." `document_links` actually lists its links (a renderer key mismatch dropped every row under the count) and shows out-of-workspace targets relative to the document, never as machine-absolute paths. `project_config` answers workspace-relative like every other tool, and `inlay_hints` renders in reading order.
