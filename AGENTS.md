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

- Establish every MCP behavior by calling the MCP, from current source, before claiming anything about it. In Codex, use `$local-mcp-development`; do not improvise the client lifecycle. In Claude Code, run `node --conditions=development packages/mcp/scripts/local-mcp.ts call <tool> '<json arguments>'`, and `… tools [--schema <tool>]` when registration or a published schema changed. Both run the same server the session attaches — official client, stdio, source entrypoint, one bounded lifecycle that closes itself.
- Invoke it through `node` rather than the `mcp:local` package script, which prefixes a runner banner, and title the shell call `Local MCP · <tool title>` to match the row the command prints. The result then reads as the attached tool's does, which is the point: the output is the evidence, so it must be the output an agent receives and nothing else. Never restate that text in commentary — say only what it decided.
- `mcp:local` answers from the working tree with no build and no restart, including edits to `@type-atlas/core`. A change is therefore never unverifiable pending a restart, and saying so is a false claim rather than a limitation. Never call a `mcp:local` result the live or session-attached MCP; it establishes behavior during development, while the attached tools confirm what a restarted client actually serves.
- Never present a direct call to a handler, formatter, or language service as MCP evidence, and never leave a client, transport, or child process alive after the call returns.
- In Claude Code, attach the source entry as a project MCP server and restart, because MCP servers are loaded once at session start and cannot be hot-reloaded: `claude mcp add --scope project type-atlas-local -- node --conditions=development <repo>/packages/mcp/src/cli.ts`. `.mcp.json` is gitignored, so this configuration stays local.
- Only the MCP process is pinned for the session. `@type-atlas/language-server` runs as a child process forked per workspace, and the pool replaces one that has exited, so `pkill -f "language-server/src/node.ts"` makes the next tool call load your edits with no restart and no build under the development condition. Prefer the language server for a change you need to verify against the attached tools mid-session; `@type-atlas/core` and `@type-atlas/mcp` are resolved once at startup and reach the attached tools only after a restart. Do not relocate a concern into the language server merely to make it reloadable.
- Codex runs `packages/mcp/dist/cli.js` while Claude Code runs `src/cli.ts`, so a Codex agent reads whatever was last built. Build the three packages after source edits, or it is running code that no longer exists.
- Before claiming post-restart readiness, build `@type-atlas/language-server`, `@type-atlas/core`, and `@type-atlas/mcp` whenever the client is configured against built `dist` output; the source entry above runs from `src` and needs no build.

MCP Tool Input Schemas:
- MCP publishes a tool's input as an object schema: `type: "object"` with `properties` and `required`. That is narrower than JSON Schema, and violating it fails silently — the tool still registers and still validates incoming arguments, but advertises nothing for a client to send, so every call fails complaining about an argument the caller did supply.
- Never declare a union at the root of a tool input. `a.or(b)` converts to `anyOf`, which has no `properties` to publish. Express a choice as one object with both keys optional and enforce the requirement in the handler, where the error can name what was actually wrong.
- Give every published property a concrete `type` or `enum` of its own. A property that publishes a choice instead has no type, and clients coerce whatever is sent to a string: an array arrives as its JSON text, a number as digits. A nullable bound such as `null | 0 <= number.integer <= 30` fails this way too — express the bound alone and reach the omitted case another way.
- A choice nested below a typed property is fine, because the container already names the shape. `read_file.file` publishes `type: "array"` whose items may be a path or a bounded view, and elements travel as the JSON they are.
- Pass the `"self"` selector when configuring a union or enum — `.configure(meta, "self")`. Without it arktype attaches the metadata to every branch and the enum becomes a list of annotated constants, losing the allowed values.
- Give `default` a scalar. arktype cannot serialize a function or an array default and publishes an internal marker such as `$ark.default` as the literal default value.
- Use `.describe()` on a type built with `.pipe()`. `.configure(meta, "self")` after a pipe attaches to the morph, and the published input schema is the pre-morph side, so the description is lost.
- Describe every property. The description is the only guidance an agent has when choosing arguments.
- Nothing upstream enforces any of this. Standard Schema requires a `validate` function and a `jsonSchema` converter and says nothing about the resulting shape; arktype converts unions to correct JSON Schema; the SDK publishes whatever it receives. A schema MCP cannot represent therefore compiles, registers, starts, and validates arguments normally. A clean typecheck and a green build are not evidence that a tool is callable.
- Verify against the published surface, never the arktype definition, because the loss happens between them. `pnpm --filter @type-atlas/mcp test` runs `test/tool-schemas.test.ts`, which connects to the packaged server over stdio and asserts every rule above against its real `tools/list` response. Run it after any tool schema change.

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
