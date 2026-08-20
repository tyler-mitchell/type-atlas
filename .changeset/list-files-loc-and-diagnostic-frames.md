---
"@type-atlas/mcp": minor
---

`list_files` prices each rendered file with its line count — `money.ts · 52 loc`, `pnpm-lock.yaml · 3.9k loc` — so a listing doubles as a reading-cost map; `loc: false` turns it off. Diagnostics no longer leak machine-absolute paths inside TypeScript message text (`import("packages/money/src/money").Money`, workspace-relative like every other path), and when several problems share a line each code frame now carets its own span instead of the last one's.
