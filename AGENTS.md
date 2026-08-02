Code Guidelines:
- Scripting Language: TypeScript script files
- Programming Style: Functional Programming

Implementation Planning:
- Before implementing a new language-server or MCP capability, first identify what existing Volar.js / LSP capabilities already provide that behavior or most of it.
- Prefer leveraging or composing existing Volar.js capabilities before building new custom logic from scratch.
- If custom implementation is still needed, document the gap in existing Volar.js behavior and keep the custom layer narrowly scoped around that gap.
- After inspecting or experimentally proving a Volar.js affordance, update the locally retained `docs/volar-affordance-evidence.md`. Record the installed source, observed contract, Type Atlas consequence, and validation status.
- Trace each affordance through every owning layer before concluding it is absent: LSP protocol and client feature, `@volar/language-server`, `@volar/language-service`, `volar-service-typescript`, `@volar/typescript`, `@volar/kit`, and `@volar/vscode` when host behavior is relevant. A custom boundary requires both installed-source evidence that these layers do not provide it and an executable reproduction of the remaining gap.

Type Atlas MCP Usage:
- When a user says to use the "live", "actual", or "direct" MCP, they mean Type Atlas attached to the current Codex session as first-class tools.
- Do not claim to have used the live/direct MCP when using a shell-launched process, external client, probe, or harness.
- If the session-attached MCP is unavailable, say so plainly.
- Before claiming post-restart readiness, build `@type-atlas/language-server`, `@type-atlas/core`, and `@type-atlas/mcp`; the live Codex configuration uses built `dist` output.

MCP Output Design:
- For agent-facing exploratory tools, prefer text as the canonical result view and keep it actually useful for agent decision-making.
- Do not dump JSON into text, but do format the real page of results in text when that is what the agent is meant to inspect.
- Keep `structuredContent` metadata-first by default: counts, paging state, probe/context fields, and similar control-plane data.
- Do not mirror large arrays, itemized page payloads, or other bulky result bodies into both text and `structuredContent`.
- Only return large per-item structured payloads when there is a concrete machine-consumption need that justifies them.
- For module export discovery, default the tool toward runtime/API-surface exports rather than flooding agents with type-only symbols.
- If type-like exports matter, expose an explicit opt-in such as `surface="all"` instead of making type-heavy output the default.

Release Discipline:
- Before finalizing any consumer-visible change under `packages/`, add a Changeset in the same change. This includes MCP tools, schemas, output, metadata, executables, runtime behavior, dependencies, and installation behavior.
- Select every directly affected package and describe the change for package consumers. Use patch for compatible fixes, minor for compatible capabilities, and major for incompatible public changes.
- Do not add a Changeset only when the work cannot affect a packed package or its consumers. Treat build, packaging, and release changes as consumer-visible when they can alter published artifacts.
- Never edit package versions, changelogs, or Registry versions manually. Changesets owns package versions and changelogs; `pnpm release:version` synchronizes `server.json`.
- Before handing off a distribution or release change, run `pnpm check:distribution` in addition to the normal repository checks.
