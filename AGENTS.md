Code Guidelines:
- Scripting Language: TypeScript script files
- Programming Style: Functional Programming
- Comments: bare minimum, caveman prose. Say the thing in the fewest plain words that still carry it — short clauses, no essays, no story of how the code got here. A comment earns its line only when the code cannot state the constraint itself. This binds every comment you write or edit; it is never an activity of its own, and never a reason to touch comments the work did not already touch.

## Shared Agent Workflow

- Daily and Bumpy base branch: `main`
- Generated version PR: `bumpy/version-packages`

The human owns the checked-out branch. Agents never create, switch, rename,
delete, reset, or replace branches unless the human requests that exact
operation. If another branch is checked out, continue there and report the
difference.

Work and commit on the checked-out branch. Stage only task-owned files. If the
index already contains another agent’s files, commit task-owned paths only and
leave the other staged entries untouched with
`git commit --only -- <task-owned paths>`. Never delete `.git/index.lock`; wait
for the other Git operation to finish.

`commit` authorizes a local commit only. `push` authorizes the checked-out
branch and includes every unpushed commit already on it; report that complete
commit set before pushing. Consumer-visible package changes include one
maintained Bumpy bump file. Agents never create task branches or worktrees.

Pushing `main` makes Bumpy create or update `bumpy/version-packages`; it does not
publish.

If the push is rejected because the remote advanced, never force-push or rebase.
When the worktree is clean and no parallel agent has uncommitted work, merge
`origin/main` into the checked-out `main`, then push once.

Only an explicit `release` request authorizes queuing `bumpy/version-packages`
with `vp run release:merge`. GitHub owns publication and public verification.
Never version packages, edit generated changelogs, publish locally, dispatch
release workflows, poll CI, or read successful-job logs.

Run `vp run release:pr` once. If the PR is absent, return to useful work; GitHub
owns the pending workflow. If it is behind `main`, run `vp run release:update`
once and let required checks rerun.

Synchronize `main` from `origin/main` only with a clean worktree and no parallel
uncommitted work. Fast-forward only. Never rebase or force-push shared commits.

Command Mandate:
- The development command surface is CLOSED: every toolchain workflow is a named task — a package.json script or a `run.tasks` entry in a vite.config.ts — invoked as `vp run <task>` at the root or `vp run "<package>#<task>"` from anywhere. `vp run` with no arguments lists the whole catalog. Nothing else is a sanctioned way to lint, format, typecheck, build, test, capture, or verify in this repository, and every agent conforms to the same surface: no bespoke invocations, no per-agent command dialects.
- One program per invocation, everywhere — agent shell calls, package.json script bodies, and task commands alike. No `&&`, `;`, or `|`, no redirection, no environment-variable prefixes, no `cd`, and no filtering a run's output through `tail`/`head`/`grep`: output is read whole, and narrowing happens at the source (`vp lint --quiet` exists for exactly this). A workflow that seems to need shell composition is a missing task — add the task, never improvise the invocation.
- Sequencing is Vite+'s job, not shell's and not a script's: `run.tasks` entries with `dependsOn` edges in vite.config.ts. Config-defined tasks cache by default, so anything with external effect (publishing, registry reads, server replays) declares `cache: false`. A task name may live in vite.config.ts or package.json but never both, and a `dependsOn` edge may point at a package.json script (witnessed: language-server `test` → `build`).
- TypeScript under `scripts/` owns only product-specific generation and public verification behind root tasks. Invoke Bumpy directly through `vp run release`; never wrap or reproduce its versioning, changelog, pull-request, publication, or recovery logic.
- Parameterized tasks (`case`, `accept`) take exactly one data argument — a scenario name. Arguments select data; they never reshape a command with extra flags.
- Inside script and task lines, run TypeScript with plain `node`: the `vp` that executes those lines is the workspace `.bin` shim, which has no `env` subsystem, so `vp node` fails there with "Command 'node' not found". The pinned `.node-version` runtime strips types natively. `vp node` remains fine from an interactive shell.
- Sanctioned outside the task surface — this list is exhaustive: vp's dependency and inspection built-ins where they are themselves the advertised interface (`vp install` / `vp add` / `vp remove` / `vp why` / `vp pm` / `vp toolchain` / `vp run --last-details`), the release workflow's initial `pnpm install` before workspace `vp` exists, plain single `git` commands, and the MCP dev attach line (`node --conditions=development packages/mcp/src/cli.ts`). ANY other CLI invocation, however small — a `pkill`, an `ls`, a one-off `node` — signals a missing task: process-lifecycle rituals included (stopping attached dev servers is `vp run dev:stop`, never a hand-typed `pkill`). `fixtures/ledger/**` manifests are fixture content, not part of this surface.

Vite+ Toolchain:
- This is a Vite+ monorepo: `vp` is the one command surface for toolchain work. `vp install` / `vp add` / `vp remove` for dependencies, `vp test` for Vitest, `vp lint` / `vp fmt` / `vp check` for lint, format, and typed checks, `vp pack` for library builds, `vp run` for package scripts, `vp node` for TypeScript scripts (interactive shells only — see the Command Mandate), `vp pm` to forward anything else to pnpm. Never invoke `vitest`, `tsdown`, `oxlint`, or `oxfmt` directly and never add them as dependencies — vite-plus bundles all of them (`vp toolchain` lists the set and versions).
- Never `cd` to scope a command. Scope with `vp -C <dir>`, a task specifier (`vp run "@type-atlas/mcp#test"`), or filters (`vp run -r <script>` for every package, `vp run -F <pattern> <script>`). `vp run` adds task caching and dependency ordering that raw recursive pnpm does not have.
- `vp test` always runs the built-in Vitest; `vp run test` (shorthand `vpr test`) runs a package's `test` script. The same built-in-versus-script split applies to `dev`, `build`, and `check`.
- Configuration lives in `vite.config.ts` only: the `test` block replaces `vitest.config.ts`, the `pack` block replaces `tsdown.config.ts`, and the `lint` / `fmt` blocks replace standalone rc files. The root `vite.config.ts` `pack` block is the workspace publish contract (ESM-only, dts, attw and publint as build gates) and resolves for every package without its own config; a package-level `vite.config.ts` replaces the root's rather than extending it, so it must restate the full contract — `packages/core/vite.config.ts` is the example.
- Test code imports from `vite-plus/test` (`vite-plus/test/node` for node-side types), config from `vite-plus` — never from `vitest`. The one exception: `declare module "vitest"` type augmentations must keep targeting `vitest` to merge.
- Never format the byte-exact artifacts: `fixtures/**` (deliberately shaped files — a mangled file is `format_document`'s subject, and scenario positions point into exact lines), `packages/mcp/test/scenarios/responses/**`, and the generated docs (`README.md`, `packages/mcp/README.md`, `docs/tools/**`) are the byte-true output of their own generators, compared byte-for-byte. The root `fmt.ignorePatterns` excludes them; a repo-wide `vp fmt .` once rewrote all three classes and broke 17 scenario gates at once. The lint block fences `fixtures/**` the same way — the fixture is deliberately defective (a broken file is the diagnostics scenarios' subject), so linting it only reports the corpus working as designed.
- `vitest` exists in this repository only as vite-plus's own dependency: `pnpm-workspace.yaml` aliases `vite` to `@voidzero-dev/vite-plus-core` and pins `vitest` to the bundled version. Every manifest that declares `vite-plus` must carry the same toolchain context — `@types/node`, `typescript`, `vite`, `vite-plus`, all `catalog:` — because vite-plus-core optionally peers on `typescript`, `@types/node`, `@arethetypeswrong/core`, and `publint`, and a tool dependency that only some manifests carry splits pnpm's peer resolution into multiple vitest instances. The symptom is every snapshot test failing with `The snapshot state … is not found. Did you call 'SnapshotClient.setup()'?` — the runner and the imported `expect` are different copies of the same version. Diagnose with `pnpm why -r vitest`; healthy is "Found 1 version" with a single instance.

Implementation Planning:
- Before implementing a new language-server or MCP capability, first identify what existing Volar.js / LSP capabilities already provide that behavior or most of it.
- Prefer leveraging or composing existing Volar.js capabilities before building new custom logic from scratch.
- If custom implementation is still needed, document the gap in existing Volar.js behavior and keep the custom layer narrowly scoped around that gap.
- After inspecting or experimentally proving a Volar.js affordance, update the locally retained `docs/volar-affordance-evidence.md`. Record the installed source, observed contract, Type Atlas consequence, and validation status.
- Trace each affordance through every owning layer before concluding it is absent: LSP protocol and client feature, `@volar/language-server`, `@volar/language-service`, `volar-service-typescript`, `@volar/typescript`, `@volar/kit`, and `@volar/vscode` when host behavior is relevant. A custom boundary requires both installed-source evidence that these layers do not provide it and an executable reproduction of the remaining gap.

Type Atlas MCP Usage:
- Development here is driven by calling the MCP, not by reading its source. Before asserting anything about a tool's behavior, output, schema, defaults, errors, or performance, call that tool and read what it returned. This is a requirement, not a preference: a passing build, a green test, a clean typecheck, and a correct-looking diff are all compatible with a tool that is unusable, and this repository has shipped exactly that. Treat any claim about agent-facing behavior that is not backed by a literal tool result as unsupported, including your own.
- Every defect found here so far was found by calling a tool and reading the result — an input schema that published no arguments, a parameter that rejected valid numbers, a probe that leaked a source file per call, a fold that hid a module's entire public surface. None was visible in the source, none was caught by a test, and reasoning about the implementation instead produced confident wrong conclusions each time.
- After changing a tool, call it, then call the neighboring tools the change could plausibly affect. Use the returned paths, ranges, and symbols for the next real action rather than inspecting output and returning to source reading.
- Every client attaches this MCP by running the source entrypoint, `node --conditions=development packages/mcp/src/cli.ts`, so the attached tools already serve the working tree. Wrap that command in `mcp-reloader --cwd <repo root> -- …` so the server gains a `reload` tool: after an edit, call `reload`, then call `mcp__type-atlas__*` normally and it runs the new code with the connection intact. No `--build` is needed, because the launch line already runs source, so one re-spawn picks up edits to core, mcp, and the language server together. `reloaderoo` proxy mode cannot be used for this — it fails to start against any server, and its README advertises an `inspect mcp` subcommand its CLI does not ship. Load your agent's local-MCP skill for the rest; the methodology lives there, not here.
- Proxy mode is the required mode, not a preference. This server is stateful — a forked language server per workspace, a TypeScript program, a semble connection — and reloaderoo's own documentation disqualifies its CLI mode for exactly that: "Servers with in-memory state machines won't work properly in CLI mode. Each command is isolated — no shared state between calls. For stateful servers, use Proxy mode instead."
- `reloaderoo inspect call-tool … -- node --conditions=development src/cli.ts` still answers correctness questions with no client configuration, and it always runs the working tree, which makes it the right tool while writing code. It spawns a whole server per call, so every number it produces is cold: process boot, workspace initialization, LSP handshake, TypeScript program construction, and semble's index build are all inside the measurement. Never report an `inspect` duration as a tool's latency — a project check measured 32.3s that way, most of it startup. Timing claims require proxy mode.
- Never build a client, proxy, or CLI that stands in for this server. It re-implements what is already attached, drifts from it, and becomes a thing to debug in place of the server.
- Never present a direct call to a handler, formatter, or language service as MCP evidence, and never leave a client, transport, or child process alive after a call returns. An abandoned language server has burned a core here for half an hour, because a cancelled request keeps running.
- The attached session pins `@type-atlas/core` and `@type-atlas/mcp` at startup, but forks `@type-atlas/language-server` per workspace and replaces one that has exited, so the `reload` tool (which restarts the backend) makes the next attached call load language-server edits. Do not relocate a concern into the language server merely to make it reloadable.
- Those two halves therefore run different generations of the source, and a change to the requests between them breaks every client already connected: a pinned core keeps sending a request the freshly forked language server no longer handles, and every tool that reaches the server fails with `Unhandled method …`. The server is not broken and the working tree is not wrong — the process is old. `vp run dev:stop` exists for exactly this and nothing else: it stops every attached client's server so each reloader respawns it on current source — the cross-client ritual after changing the custom protocol. It is the wrong tool for your OWN session (your reloader respawns the child the instant it dies, on whatever tree exists right then — witnessed serving stale code); for your own session, call the `reload` tool.
- A client pointed at `packages/mcp/dist/cli.js` serves whatever was last built and drifts silently from the working tree — which is how a Codex agent once ran a five-day-old server, including an experiment already deleted from source. `dist` is a release artifact, validated at publication; it is never how an agent attaches during development. If a client's behavior contradicts the working tree, check its configured entrypoint before diagnosing anything else.
- Never set an environment flag on one client that another does not set. A flag only one client passes means only that client executes the code behind it, so a fault there is invisible everywhere else and impossible to reproduce from the other side.

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

Measuring Tool Latency:
- Every tool result ends with its own elapsed time. That footer is the instrument: edit, `reload`, call the tool, read the number. Do not spawn a wrapper client to time the server from outside — the loop that exists for developing this MCP is the loop that measures it.
- Measure symbols an agent actually navigates. `res` in `webgpu-engine/src/core/assembly.ts` has 1,761 references and a 600-line declaration; a helper with one caller proves nothing and hid a 1.3-second defect through an entire session of "fast" readings.
- A cold first semantic call is not one quantity. The same call measured 1,194ms, 5,661ms, 7,461ms, 9,847ms, and a 30-second timeout, depending only on how many TypeScript programs the machine was building at that instant. Never quote a single cold sample as a figure; say what the machine was doing.
- Check load before trusting any measurement. Each MCP client forks its own language server, and several editors open on the same monorepo means several copies of the same program competing. `uptime` before a number is worth more than the number.

Latency This MCP Does Not Control:
- A tool call costs a full model turn — measured at ~3.5s in this repository's sessions, and reported as 2-4s generally. An unrelated MCP returning nine lines of JSON pays the same, so a tool whose own work is 2ms and one that does nothing are indistinguishable from the caller's seat. Optimizing below a few hundred milliseconds buys nothing a user can feel.
- What does buy time is answering in fewer turns. `inspect_symbol` composes what would otherwise be seven separate language-server calls; at the per-turn cost that is worth about twenty seconds, more than every server-side optimization in this repository combined. Prefer composing an answer over adding another single-purpose tool.
- Tool descriptions and schemas are serialized into every request, so wording is a per-call cost paid whichever tool is called. Say each thing once: guidance that belongs in the server instructions does not also belong in a tool description.
- Claude Code defers MCP tool schemas by default and loads them on demand; `ENABLE_TOOL_SEARCH=false` disables that and sends every schema from every connected server on every request. Check it before attributing a uniform per-call delay to anything in this codebase.

Abandoned Requests Wedge A Workspace:
- A semantic request cannot be cancelled — see `docs/volar-affordance-evidence.md` § "Semantic requests cannot be cancelled". Abandoning a call does not stop it, and while it runs the language server holds its only thread and stops reading IPC, so every later call for that workspace waits behind it. A folded five-line `read_file` needing no type checking has timed out at thirty seconds this way.
- The tool timeout therefore reports, but does not remedy: the next call to that workspace queues behind the same work and times out too. Wall-clock outliers measured against a workspace you have already abandoned a call in are measuring that queue, not the call you are timing. Reload or use a different workspace before trusting the number.
- The evidenced remedy is ending the process; `dispose()` on the workspace does that and the pool starts a fresh one on the next call. Wiring that to the timeout trades a rebuild for an unbounded queue and has not been done.

Known Architectural Cost:
- One language server is built per client, and a second per nested workspace root within a client — naming a monorepo and then a package inside it opens two workspaces and builds that package's program twice. Volar resolves the owning project per URI, so the second workspace answers identically; it exists only because the pool keys on the exact root.
- Sharing a parent workspace with a nested root is not a one-line change. A workspace resolves relative paths against its own root, so reusing the parent silently re-resolves `src/render/gpu-cull.ts` against the monorepo. Any fix must keep the requesting root for path resolution and `changedFiles` while sharing the process underneath.

Release Discipline:
- Bumpy is the sole release authority. It owns bump intent, fixed-suite versioning, dependency propagation, changelogs, the version pull request, npm publication, tags, GitHub Releases, and retry state. Never add a parallel release path, call a local version/publish command, or recreate any of those concerns in scripts or workflows.
- Load `.skills/add-change/SKILL.md` for every consumer-visible package change. Invoke its Bumpy commands through the closed task surface as `vp run release <arguments>`; for example, `bumpy status --json` becomes `vp run release status --json`.
- Keep one bump file per logical change and update it as the implementation changes. Bumpy's fixed group releases all four public packages together; name only packages changed directly and let Bumpy propagate the rest.
- A request to commit authorizes adding or updating the bump file and committing the intended change. A request to push authorizes pushing it; the Bumpy workflow then maintains the version PR. Only an explicit release request authorizes merging that PR.
- For an explicit release, inspect with `vp run release:pr`, then squash-merge with `vp run release:merge`. Bumpy's publish job completes npm, GitHub Release, MCP Registry, and production verification; the standalone MCP Registry workflow is recovery only.
- Never edit package versions, changelogs, `server.json`, or release tags. `server.json` is generated from `server.template.json` and the MCP package version by the `registry:prepare` task.
- Every npm trusted publisher must name `release.yml`, repository `tyler-mitchell/type-atlas`, environment `publish`, and allow direct publication. The workflow and npm trust claims change together.
- Bumpy 1.18.1 only maps files below a package directory. A root `vite.config.ts` pack-contract change must name every affected public package; a change to `server.template.json` or `scripts/prepare-registry-manifest.ts` must name `@type-atlas/mcp`. Catalog changes are attributed to consumers by Bumpy itself.
- A genuinely new npm package name still requires npm's one-time first publication and trusted-publisher setup before Bumpy can publish it through OIDC. Follow Bumpy's upstream first-package guidance; never restore project-specific bootstrap machinery.
