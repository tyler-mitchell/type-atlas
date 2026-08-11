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
- When a user says to use the "live", "actual", or "direct" MCP, they mean Type Atlas attached to the current agent session as first-class tools.
- Do not claim to have used the live/direct MCP when using a shell-launched process, external client, probe, or harness.
- If the session-attached MCP is unavailable, say so plainly.

- In Codex, use `$local-mcp-development` exactly for local MCP development and verification; do not improvise the client lifecycle. That skill depends on Codex's `code_mod` tool and has no Claude Code equivalent.
- In Claude Code, attach the source entry as a project MCP server and restart, because MCP servers are loaded once at session start and cannot be hot-reloaded: `claude mcp add --scope project type-atlas-local -- node --conditions=development <repo>/packages/mcp/src/cli.ts`. Source edits also require a restart before the attached tools reflect them. `.mcp.json` is gitignored, so this configuration stays local.
- Before claiming post-restart readiness, build `@type-atlas/language-server`, `@type-atlas/core`, and `@type-atlas/mcp` whenever the client is configured against built `dist` output; the source entry above runs from `src` and needs no build.

MCP Tool Input Schemas:
- MCP publishes a tool's input as an object schema: `type: "object"` with `properties` and `required`. That is narrower than JSON Schema, and violating it fails silently — the tool still registers and still validates incoming arguments, but advertises nothing for a client to send, so every call fails complaining about an argument the caller did supply.
- Never declare a union at the root of a tool input. `a.or(b)` converts to `anyOf`, which has no `properties` to publish. Express a choice as one object with both keys optional and enforce the requirement in the handler, where the error can name what was actually wrong.
- Keep each published property expressible: a concrete `type`, or `enum`. A property whose value may be an array must publish `type: "array"`, or clients serialize the array to a string.
- Pass the `"self"` selector when configuring a union or enum — `.configure(meta, "self")`. Without it arktype attaches the metadata to every branch and the enum becomes a list of annotated constants, losing the allowed values.
- Give `default` a scalar. arktype cannot serialize a function or an array default and publishes an internal marker such as `$ark.default` as the literal default value.
- Use `.describe()` on a type built with `.pipe()`. `.configure(meta, "self")` after a pipe attaches to the morph, and the published input schema is the pre-morph side, so the description is lost.
- Describe every property. The description is the only guidance an agent has when choosing arguments, and `test/tool-schemas.test.ts` asserts all of the above against the packaged server's real `tools/list` output.

MCP Output Design:
- For agent-facing exploratory tools, prefer text as the canonical result view and keep it actually useful for agent decision-making.
- Do not dump JSON into text, but do format the real page of results in text when that is what the agent is meant to inspect.
- Keep `structuredContent` metadata-first by default: counts, paging state, probe/context fields, and similar control-plane data.
- Do not mirror large arrays, itemized page payloads, or other bulky result bodies into both text and `structuredContent`.
- Only return large per-item structured payloads when there is a concrete machine-consumption need that justifies them.
- For module export discovery, default the tool toward runtime/API-surface exports rather than flooding agents with type-only symbols.
- If type-like exports matter, expose an explicit opt-in such as `surface="all"` instead of making type-heavy output the default.

Release Discipline:
- Treat a request to commit as authorization to finalize and commit only. Before committing, classify the in-scope change, add an accurate Changeset for every consumer-visible package change, stage the intended commit, and run `pnpm check:changeset`. A commit request does not authorize pushing, merging the version pull request, or publishing.
- Treat a request to push as authorization to push the prepared commit. The release workflow may create or update the Changesets version pull request, but do not merge it without an explicit release request.
- Treat an explicit request to release as authorization to carry the prepared change through the Changesets version pull request, npm publication, MCP Registry publication, and public verification. Follow `.skills/cli-release/SKILL.md` through completion.
- Before finalizing any consumer-visible change under `packages/`, add a Changeset in the same change. This includes MCP tools, schemas, output, metadata, executables, runtime behavior, dependencies, and installation behavior.
- Select every directly affected package and describe the change for package consumers. Use patch for compatible fixes, minor for compatible capabilities, and major for incompatible public changes.
- Do not add a Changeset only when the work cannot affect a packed package or its consumers. Treat build, packaging, and release changes as consumer-visible when they can alter published artifacts.
- Never edit package versions, changelogs, or Registry versions manually. Changesets owns package versions and changelogs; `pnpm release:version` synchronizes `server.json`.
- Before handing off a distribution change, run `pnpm check:distribution` in addition to the normal repository checks. Before publication, run `pnpm release:preflight`.
