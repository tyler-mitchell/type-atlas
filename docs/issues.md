# Issues

Things the MCP surface does that it should not, or does not that it should,
found by using it. Written at the moment of discovery, because a finding
deferred to the end of a session is a finding lost.

Every entry states **how it was observed**, because a finding without a
reproduction is a rumour, and the next reader needs to confirm it still holds
before acting on it.

An entry leaves this file when it is fixed, not when it is explained.

**〈raised〉** marks an issue Tyler raised rather than one found while working.
Those are deferred on arrival — captured here and left alone — unless they
happen to land on whatever is already open at that moment. The mark exists so
the distinction survives the session that recorded it.

One raised message often carries more than one issue. They are split here
rather than filed as one, because they are fixed separately and one of them
being done should not make the other look done with it.

---

## Next

What is being worked on and in what order, for the objective in hand. Kept at
the top because a list of defects with no stated intent is a list nobody acts
on, and this is the part that goes stale first — if it disagrees with the work,
the work is right and this needs rewriting.

Current objective: presentation consistency across the MCP surface, and
configurable path rendering.

1. **Ground `kindAt` in `SymbolKind`.** Language-neutral, and required before a
   second language is worth attempting.
3. **`workspace_symbols` returning empty** is the most damaging correctness bug
   here — it makes `find_successor` assert removal of live code — but it is a
   language-server indexing question rather than a presentation one, and has not
   been diagnosed.
4. **Retire the terminal-control exports**, or find the consumer that justifies
   them. Nothing here calls them and they are not code intelligence.

Done under this objective, for context on what the entries below survived: one
nesting mechanism replacing three, the banner, `displayPath` with three working
styles on `pathe`, presentation settings reaching the server from its
environment, the document lint, the rendered-hole check, and a page line that
states a range and names the parameter that continues it.

---

## Correctness

### `getNavigateToItems` answers nothing on the hosted language service

The cause behind `workspace_symbols`, diagnosed but not fixed.

Volar's own workspace symbol search was ruled out first: its TypeScript plugin
converts each match through `ctx.getTextDocument(...)`, which resolves only
files Volar holds open, so a workspace-wide query — almost entirely unopened
files — loses every result. `type-atlas/workspaceDeclarations` now bypasses
that and asks TypeScript directly, and the answer is still empty.

Instrumented from inside the request, against a two-file project:

```
items=0 files=[…/src/example.ts|…/src/other.ts] names=
```

The program holds the file declaring `computeTotal`, and
`getNavigateToItems("computeTotal")` returns nothing. The identical call on a
plain `ts.createLanguageService` over the same file returns the declaration, so
the query is right and the loss is in the hosted service — either the tsgo
bridge under Volar's host, or the `withEffectLanguageService` proxy in front of
it. Passing an explicit `maxResultCount` changed nothing.

`packages/language-server/test/server.test.ts` holds this as an `it.fails`, so
it reports when the behaviour returns rather than sitting silent.

### `workspace_symbols` answers empty for a project that is loaded

`indentGuide` is declared in `atlascii/src/layout/hierarchy.ts`. Asking
`workspace_symbols` for that name returns nothing, in 7ms — the signature of an
index that was never consulted, not one that was searched.

The project is demonstrably loaded: `document_symbols` on that file lists the
symbol, and `references` from it finds seven uses.

```
workspace_symbols { workspace: atlascii, file: src/layout/hierarchy.ts, query: "indentGuide" }
→ Nothing matched indentGuide … (7ms)
```

`find_successor` is built on the same index and inherits the false negative. Its
verdict was changed to state what the index holds rather than what the
repository contains, which is honest but does not fix the index.

### `search_dependency_code` fails from a nested workspace root

With `workspace` set to `atlascii/`, resolving `messageformat` reaches
`node_modules` hoisted to the monorepo root, and `getWorkspaceUri` refuses any
path outside the workspace:

```
search_dependency_code { workspace: <repo>/atlascii, package: ["messageformat"] }
→ Error: File is outside the workspace: …/node_modules/messageformat/lib/messageformat.js
```

The same query with `workspace` set to the monorepo root answers normally. The
containment check exists to stop arbitrary reads, so the fix is a decision about
how dependency reads are scoped, not a loosened predicate.

### `search_code` reports full confidence for a query that matched nothing

Relevance is relative to the strongest match, so the best of a bad set always
reads as 100%. A query of pure nonsense returns results at 100% and 92%:

```
search_code { query: "zzqx nonexistent phrase that should match nothing at all" }
→ 2 matches · relevance is relative to the strongest match
  === 1 · src/document/tags.ts:327-344 · relevance 100% ===
```

Nothing in the answer separates "this is what you asked for" from "this is the
least unlike it", and the honest answer — nothing matched — is one the tool
cannot produce. The absence branch added to `search.tool.mdoc` is reachable only
when the index is empty.

Both this and `find_successor` above break the same rule: **a tool may report
what it observed, and may not report what that observation implies about the
world.** Ranking is an observation; "this is relevant" is a conclusion.

### 〈raised〉 An absolute path appears where the default is workspace-relative

```
file_references { file: packages/mcp/src/experimental.tools.ts }
→ … anchored at packages/mcp/tsconfig.json in /Users/tylermitchell/Projects/featuretype.
```

Paths default to workspace-relative and `displayPath` renders them that way
everywhere. The root itself is the exception: preambles print it absolutely, on
the reasoning that a reader needs to know what the relative paths are read
against. That reasoning was never checked against the ask, and the ask was that
absolute paths are opt-in.

To settle broadly rather than per tool, because the root is stated in nearly
every preamble — and because there are other places an absolute path can still
surface: `project_config` asks for one deliberately, and `displayPath` falls
back to one for any file outside the root it was measured from.

### 〈raised〉 The `file_references` preamble needs rethinking

```
packages/mcp/src/experimental.tools.ts is referenced from 2 places, across every
project loaded this session, anchored at packages/mcp/tsconfig.json in
/Users/tylermitchell/Projects/featuretype.
```

One sentence carrying five facts — subject, count, scope, anchor, root — read
as a single run-on clause. Raised as needing rethinking; the shape it should
take is not decided here.

### A probe document is reported as a problem in the user's project

`listModuleExports` opens a synthetic file beside the importing one —
`<file>.type-atlas-probe.ts` — to ask what a module completes to. The language
server retains it, and a later `diagnostics` call reports it:

```
diagnostics { workspace: packages/mcp, scope: project }
→ Whole project · 1 problem in 1 file · 205 files checked
  === src/presentation.ts.type-atlas-probe.ts ===
  error typescript(1003) 1:48-1:48  Identifier expected.
```

Reproduced by calling `list_module_exports` and then `diagnostics` on the same
project. The file is this tool's own scaffolding and belongs to no source a
reader wrote, so reporting it is a phantom error in their project. Either the
probe is closed after use, or diagnostics excludes the probe suffix.

---

## Language grounding

### `kindAt` reads TypeScript hover text with a regular expression

`packages/mcp/src/navigation.tools.ts` matches
`const|let|var|function|class|interface` against hover prose to name a symbol's
kind. Every other kind in the surface comes from the protocol's own
`SymbolKind`, which is language-neutral. This one would answer wrongly, and
silently, for any language added later.

### `list_module_exports` shows TypeScript's `detail` verbatim

A re-exported alias renders as two lines — `(alias) const x: T` followed by
`export x` — because `detail` carries a newline and the second line restates the
name. Faithful, and noise. Distinguishing the signature from the declaration
form means parsing hover text, which is the same grounding problem as above.

---

## Presentation

### A location is shown three ways

Tree rows under a file (`references`, `file_references`,
`document_highlights`), a `❯` pointer (`definitions`, `implementations`,
`type_definitions`), and a bannered group (`diagnostics`).

The distinction may be real — a single jump target is not a list, and a file's
problems are blocks rather than rows — but nothing states the rule, so the next
tool will pick by feel. Either write the rule down or collapse them.

### `workspace_symbols` omits the position

`Guide [interface] src/layout/hierarchy.ts` gives no line to jump to, while
`document_symbols` gives one for the same kind of row.

### `investigate_code` titles its sections `###`

Every other tool uses `##`. Caught by the document lint's heading rule only
after it was written; the lint now holds it.

### Marks reach the components but not the partials

`asciiMarks` overrides exactly two entries — `separator` (`·` → `-`) and
`detail` (`—` → `--`). Both are honored where `rowBranches` composes a line;
every partial types the punctuation itself, so a partial-composed answer ignores
them.

Withdrawn from the server rather than half-offered: `TYPE_ATLAS_MARKS` is not
read, and `Marks` stays available to a consumer calling the components directly,
where it does work. The reasoning is at `presentationFromEnvironment` — an MCP
answer travels as JSON-RPC to a client that renders it, never to a terminal this
process can see, so an ASCII mark set answers a question this path does not ask.

Closing the gap properly would mean a `mark` call at roughly forty partial
sites, making the documents — the design artifact a successor reads — harder to
read to serve two characters. Worth revisiting only if a consumer appears that
genuinely needs ASCII-only output.

---

## Architecture

### `atlascii` still carries test-reporter output formats

Removed: `format/terminal.ts` (ANSI cursor control for a live view) and
`format/xml.ts` (JUnit escaping). Neither had a consumer beyond its own
re-export and its own test.

Still present, because each is reached by a tag and so is live API rather than
dead code: `format/command.ts` with `components/annotations.ts` (GitHub Actions
workflow commands), and `format/tap.ts` with `components/tap.ts` (TAP). They are
test-reporter output, not code intelligence, and this library describes itself as
the latter. Removing them removes the `annotations` and `tap` tags with them,
which is a scope decision about what `atlascii` is for rather than a cleanup.
