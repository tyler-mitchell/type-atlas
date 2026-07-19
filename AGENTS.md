Code Guidelines:
- Scripting Language: TypeScript script files
- Programming Style: Functional Programming

Implementation Planning:
- Before implementing a new language-server or MCP capability, first identify what existing Volar.js / LSP capabilities already provide that behavior or most of it.
- Prefer leveraging or composing existing Volar.js capabilities before building new custom logic from scratch.
- If custom implementation is still needed, document the gap in existing Volar.js behavior and keep the custom layer narrowly scoped around that gap.
- After inspecting or experimentally proving a Volar.js affordance, update `docs/implementation/volar-affordance-evidence.md` in the same change. Record the installed source, observed contract, FeatureType consequence, and validation status; affordance research is incomplete until the ledger reflects it.
- Trace each affordance through every owning layer before concluding it is absent: LSP protocol and client feature, `@volar/language-server`, `@volar/language-service`, `volar-service-typescript`, `@volar/typescript`, `@volar/kit`, and `@volar/vscode` when host behavior is relevant. A custom boundary requires both installed-source evidence that these layers do not provide it and an executable reproduction of the remaining gap.

Featuretype MCP Usage:
- When a user says to use the "live", "actual", or "direct" Featuretype MCP, they mean the Featuretype MCP attached to the current Codex session as first-class MCP tools.
- The only codified automated repo-level validation modes are the `in-memory` and `stdio` probes under `packages/mcp`.
- Do not describe `js_repl`, shell-launched stdio clients, or ad hoc Node clients as MCP validation modes.
- Do not claim to have used the live/direct MCP when you only used a repo probe, harness, or external client.
- If the session-attached Featuretype MCP is not available, say that plainly before proceeding.
- Only when you are preparing to validate or claim post-restart readiness against the session-attached live Featuretype MCP, build the runtime artifacts first. In this project, the live Codex MCP config points at built `dist` output, not source files, so do not tell the user to restart or claim readiness before those builds finish.
- This does not apply to repo probes, harnesses, or ordinary source-level development loops; it applies specifically to post-restart live MCP readiness.
- Safe default build sequence before claiming post-restart live MCP readiness: `pnpm --filter @featuretype/service build && pnpm --filter @featuretype/language-server build && pnpm --filter @featuretype/mcp build`.

MCP Output Design:
- For agent-facing exploratory tools, prefer text as the canonical result view and keep it actually useful for agent decision-making.
- Do not dump JSON into text, but do format the real page of results in text when that is what the agent is meant to inspect.
- Keep `structuredContent` metadata-first by default: counts, paging state, probe/context fields, and similar control-plane data.
- Do not mirror large arrays, itemized page payloads, or other bulky result bodies into both text and `structuredContent`.
- Only return large per-item structured payloads when there is a concrete machine-consumption need that justifies them.
- For module export discovery, default the tool toward runtime/API-surface exports rather than flooding agents with type-only symbols.
- If type-like exports matter, expose an explicit opt-in such as `surface="all"` instead of making type-heavy output the default.
