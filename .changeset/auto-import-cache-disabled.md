---
"@type-atlas/language-server": patch
"@type-atlas/mcp": patch
---

A request about a document no tsconfig owns could kill the language server: `typescript-auto-import-cache`'s project initialization dies against the typescript-native-bridge engine. The cache is now disabled via `volar-service-typescript`'s own `disableAutoImportCache` option — on this engine it crashed the server and produced no import fixes even when it survived, so nothing is lost; one flag re-enables it when the engine matures. `add_missing_imports` now says honestly when names do not resolve and the engine proposed no fix, instead of "No missing imports." `document_links` actually lists its links (a renderer key mismatch dropped every row under the count) and shows out-of-workspace targets relative to the document, never as machine-absolute paths. `project_config` answers workspace-relative like every other tool, and `inlay_hints` renders in reading order.
