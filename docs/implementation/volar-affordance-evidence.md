# Volar Affordance Evidence Ledger

## Scope and evidence standard

This ledger records objective findings from the installed packages used by the
code-intelligence MCP. First-hand use through the official MCP client and stdio
transport is the source of truth for agent-facing behavior. Installed package
source and exported declarations establish ownership and contracts; focused
checks preserve observed failures as secondary regression safeguards.
High-level documentation, fixtures, and inferred behavior do not establish that
an agent workflow is usable.

Each finding has one implementation consequence:

- **Reuse** — FeatureType calls or preserves the upstream contract.
- **Host-bound** — the affordance is implemented but requires the VS Code
  extension host and cannot execute in the headless MCP process.
- **Insufficient contract** — the API performs a narrower operation and cannot
  replace the headless workspace-edit boundary.
- **Not editing** — the affordance is useful for inspection or project state,
  but does not apply source edits.
- **Required client adapter** — Volar owns the protocol and semantic behavior;
  the headless client supplies only the operating-system or host bridge.
- **Target** — the upstream contract is verified, but current FeatureType code
  still duplicates or has not yet composed the affordance.
- **Unresolved** — the inspected source narrows the boundary but does not yet
  license an implementation decision.

Versions are the resolved versions in the current pnpm lockfile and installed
store, not dependency ranges.

Validation state: installed-package findings below were confirmed against the
resolved JavaScript implementation or exported declaration on 2026-07-15.
Explicitly labeled reference-project patterns preserve their repository,
revision, and source path and are not treated as installed behavior. Entries
that describe FeatureType behavior are additionally tied to the named source
and test files in the executable-evidence section.

## Representation selection rule

When upstream exposes multiple representations of the same semantic fact, use
the highest-level representation designed for human editor consumption. A
lower-level contract is not an alternative merely because it contains enough
data to reconstruct the same result.

```txt
mapped authored LSP result  >  virtual-code or source-map offsets
LocationLink                >  Location when link support is available
hierarchical DocumentSymbol >  folding ranges or semantic-token structure
SignatureHelp               >  reconstructing a signature from completion data
resolved editor item        >  unresolved provider metadata when details are requested
CodeAction title/state       >  deriving fix intent from diagnostic codes
```

The lower-level affordance remains independently useful only when it exposes a
different observation: semantic tokens classify source, folding ranges describe
collapsibility, virtual-code requests inspect generated documents, and source
maps explain authored/generated correspondence. None should be used to rebuild
hover, navigation, symbols, diagnostics, or other higher-level results that
Volar already returns.

## Headless file watching is a client adapter

The language server owns watcher patterns through standard dynamic LSP
registration. The headless client owns only the operating-system subscription
that turns matching changes into `workspace/didChangeWatchedFiles`.

```ts
// @volar/kit@2.4.28 README — Example: Use FileWatcher
import { watch } from "chokidar"

createWatcher(path.dirname(tsconfig), ["ts", "js", "foo"])
  .on("add", fileName => project.fileCreated(fileName))
  .on("unlink", fileName => project.fileDeleted(fileName))
  .on("change", fileName => project.fileUpdated(fileName))
```

```ts
// packages/code-intelligence/src/volar-workspace.ts
const watcher = watch(workspaceRoot, {
  ignoreInitial: true,
  followSymlinks: false,
})

watcher.on("all", (event, filePath) => {
  const relativePath = path.relative(workspaceRoot, filePath)
  const types: readonly FileChangeType[] = event === "change"
    ? [FileChangeType.Changed]
    : event === "add" || event === "addDir"
    ? [FileChangeType.Created]
    : [FileChangeType.Deleted]
  void sendFileChanges(relativePath, types)
})
```

Project consequence: use Chokidar for the host subscription and preserve
Volar's registered patterns and `DidChangeWatchedFilesNotification` as the
invalidation contract. Raw recursive `node:fs` watching failed with `EMFILE` in
a real Codex task before the first file-backed request; native `read_file`
completed after this adapter correction.

Status: upstream pattern and native dynamic-tool result observed.

## Structural ancestry is a native cross-language request

The installed TypeScript, Markdown, and JSON services all advertise
`selectionRangeProvider` and return their own nested syntax-aware ranges. The
headless client only needs to advertise support and forward
`textDocument/selectionRange`.

```js
// volar-service-typescript@0.0.71 — lib/plugins/syntactic.js
capabilities: {
  foldingRangeProvider: true,
  selectionRangeProvider: true,
  documentSymbolProvider: true,
}
```

```js
// volar-service-markdown@0.0.71 — index.js
provideSelectionRanges(document, positions, token) {
  if (prepare(document)) {
    return mdLs.getSelectionRanges(document, positions, token)
  }
}
```

```js
// volar-service-json@0.0.71 — index.js
provideSelectionRanges(document, positions) {
  return worker(document, jsonDocument =>
    jsonLs.getSelectionRanges(document, positions, jsonDocument)
  )
}
```

Project consequence: expose the returned parent chain directly as
`selection_ranges`. Do not infer an enclosing function, object member, Markdown
section, or JSON property from text, symbols, folding ranges, or a custom parser.

Status: installed providers and client/server request path confirmed on
2026-07-26; source-level MCP behavior observed after implementation.

## Document-link discovery and resolution are native requests

The installed server advertises document links whenever a configured language
service provides them. It retains the language service used for discovery and
routes the standard resolve request back to that service.

```js
// @volar/language-server@2.4.28 — lib/features/languageFeatures.js
server.connection.onDocumentLinks(async (params, token) => {
  const uri = URI.parse(params.textDocument.uri)
  return await worker(uri, token, languageService => {
    lastDocumentLinkLs = languageService
    return languageService.getDocumentLinks(uri, token)
  })
})

server.connection.onDocumentLinkResolve(async (link, token) => {
  return await lastDocumentLinkLs?.resolveDocumentLink(link, token)
})
```

```js
// volar-service-markdown@0.0.71 — index.js
async provideDocumentLinks(document, token) {
  if (prepare(document)) {
    return await mdLs.getDocumentLinks(document, token)
  }
}

async resolveDocumentLink(link, token) {
  return await mdLs.resolveDocumentLink(link, token) ?? link
}
```

```js
// volar-service-json@0.0.71 — index.js
provideDocumentLinks(document) {
  return worker(document, jsonDocument =>
    jsonLs.findLinks(document, jsonDocument)
  )
}
```

Project consequence: `document_links` forwards discovery and resolves only
unresolved results through the standard LSP request. Path parsing remains a
presentation concern; link discovery and target resolution remain entirely
language-service-owned.

Status: installed providers and server routing confirmed on 2026-07-26;
source-level MCP behavior observed after implementation.

## Markdown diagnostics require the native configuration value

The installed Markdown service advertises pull diagnostics, but deliberately
does not compute them until its `getDiagnosticOptions` hook returns the
language-service-native `DiagnosticOptions` object.

```js
// volar-service-markdown@0.0.71 — index.js
getDiagnosticOptions = async (_document, context) => {
  return await context.env.getConfiguration?.('markdown.validate')
}

async provideDiagnostics(document, token) {
  if (prepare(document)) {
    const configuration = await getDiagnosticOptions(document, context)
    if (configuration) {
      return mdLs.computeDiagnostics(document, configuration, token)
    }
  }
}
```

```ts
// vscode-markdown-languageservice@0.5.0-alpha.6
export interface DiagnosticOptions {
  readonly validateReferences: DiagnosticLevel | undefined
  readonly validateFragmentLinks: DiagnosticLevel | undefined
  readonly validateFileLinks: DiagnosticLevel | undefined
  readonly validateMarkdownFileLinkFragments: DiagnosticLevel | undefined
  readonly validateUnusedLinkDefinitions: DiagnosticLevel | undefined
  readonly validateDuplicateLinkDefinitions: DiagnosticLevel | undefined
  readonly ignoreLinks: readonly string[]
}
```

Project consequence: answer the existing standard `workspace/configuration`
request for `markdown.validate` with that exact object. Do not add a Markdown
parser, link checker, diagnostic adapter, or separate validation tool. The
service remains responsible for link discovery, filesystem observation,
severity, ranges, messages, and related code actions.

Status: installed provider contract and configured behavior observed through one
official-client stdio session on 2026-07-26. Duplicate definitions now produce
native warnings with related locations, and unused definitions produce native
hints. Missing-file diagnostics remain blocked by an installed provider defect:
`volar-service-markdown@0.0.71` returns `{ isDirectory: undefined }` when
`context.env.fs.stat(resource)` returns `undefined`, which
`vscode-markdown-languageservice` treats as an existing path. Do not replace the
native checker in the MCP; correct or upgrade that provider boundary when the
upstream package exposes a fixed contract.

## TypeScript must remain a physical runtime dependency

TypeScript locates its standard library relative to the executing TypeScript
module. Bundling `typescript.js` into a language-server artifact changes that
location and makes valid projects appear to lack `Promise`, `Array`, and other
standard declarations.

```ts
// typescript@5.9.3 lib/typescript.js — createCompilerHostWorker
function getDefaultLibLocation() {
  return getDirectoryPath(normalizePath(system.getExecutingFilePath()))
}

getDefaultLibFileName: options =>
  combinePaths(getDefaultLibLocation(), getDefaultLibFileName(options))
```

```ts
// packages/code-intelligence-codex/tsup.config.ts
external: ["typescript", "vite"]
```

Project consequence: the language-server bundle may include FeatureType's
composition layer, but it loads TypeScript from its installed package so
`lib.esnext.full.d.ts` remains discoverable. The native diagnostics result for
`packages/code-intelligence/src/operations.ts` changed from three false missing-
library errors to an empty result after externalization.

Status: installed source and native dynamic-tool result observed.

## Human-facing call hierarchy boundary

`vscode-languageclient` owns protocol conversion and provider registration. It
does not turn call-hierarchy responses into a textual or flattened report.

```ts
// microsoft/vscode-languageserver-node/client/src/common/callHierarchy.ts
return client.sendRequest(CallHierarchyPrepareRequest.type, params, token)
  .then(result =>
    client.protocol2CodeConverter.asCallHierarchyItems(result, token)
  )

Languages.registerCallHierarchyProvider(
  client.protocol2CodeConverter.asDocumentSelector(options.documentSelector),
  provider,
)
```

`@volar/vscode` adds Volar-specific client features for auto-insertion,
document-drop edits, file references, project reload, TypeScript version, and
tsconfig discovery. It has no separate call-hierarchy presentation layer and
therefore leaves the standard provider to `vscode-languageclient` and VS Code.

The VS Code workbench is the layer that makes the operation human-observable.
It expands one direction and one tree level at a time. Protocol `fromRanges`
become navigation locations associated with the child; they are not rendered
as tree labels, but the preview uses them to highlight and reveal the actual
call sites.

```ts
// microsoft/vscode/src/vs/workbench/contrib/callHierarchy/browser/callHierarchyTree.ts
if (direction === CallHierarchyDirection.CallsFrom) {
  return (await model.resolveOutgoingCalls(item, token)).map(call =>
    new Call(
      call.to,
      call.fromRanges.map(range => ({ range, uri: item.uri })),
      model,
      parent,
    )
  )
}

template.label.setLabel(
  element.item.name,
  element.item.detail,
  { labelEscapeNewLines: true, matches, strikethrough: deprecated },
)

let locations = element.locations
if (!locations) {
  locations = [{ uri: element.item.uri, range: element.item.selectionRange }]
}
for (const location of locations) {
  decorations.push({ range: location.range, options })
}
```

Consequence: a headless agent client should preserve Volar's hierarchy items and
navigation ranges while exposing the operation one direction and one level per
request. The MCP text view prints each native item, relation, selection/body
range, and call-site range. It does not reproduce the VS Code tree model,
preview state, or editor commands.

The installed server already returns every semantic field needed by that
presentation. No call discovery, grouping, or range derivation belongs in the
MCP:

```json
{
  "from": {
    "name": "compileTensorTrainingCapability",
    "uri": "file:///.../create-tensor-program-capability.ts",
    "range": {
      "start": { "line": 582, "character": 40 },
      "end": { "line": 647, "character": 4 }
    },
    "selectionRange": {
      "start": { "line": 582, "character": 6 },
      "end": { "line": 582, "character": 37 }
    }
  },
  "fromRanges": [
    {
      "start": { "line": 623, "character": 27 },
      "end": { "line": 623, "character": 44 }
    }
  ]
}
```

The native distinction was observable in
`packages/webgpu-engine/src/domains/learning/framework/compiler/plan-tensor-storage.ts`.
An incoming file-level test item had a declaration selection of `1:1`; its
`fromRanges` contained the actionable calls at zero-based lines 253, 285, and
321. Returning the original relation preserves both meanings without an MCP
interpretation layer.

Status: upstream-source, raw language-server response, and source-level MCP
text result observed.

## MCP request and presentation boundary

The MCP registers explicit agent operations. Each operation calls the installed
request descriptor so Volar and the protocol packages continue to own request
method names, parameter types, response types, project selection, and semantic
behavior.

```ts
// packages/code-intelligence-mcp/src/tools.ts
const items = await workspace.sendRequest(
  CallHierarchyPrepareRequest.type,
  {
    textDocument,
    position,
  },
  signal,
)

const calls = await workspace.sendRequest(
  CallHierarchyIncomingCallsRequest.type,
  { item },
  signal,
)
```

Agent-owned input contracts are static ArkType schemas. The public contract uses
an absolute workspace root, a workspace-relative or contained absolute file,
and literal LSP positions: zero-based lines and UTF-16 characters. No coordinate
conversion occurs. The MCP SDK registration API accepts Zod schemas, so ArkType
JSON Schema is adapted to Zod only at registration.

```ts
const References = type({
  workspace: "string >= 1",
  file: "string >= 1",
  position: type({
    line: "number.integer >= 0",
    character: "number.integer >= 0",
  }).onUndeclaredKey("reject"),
  "includeDeclaration?": "boolean",
  "offset?": "number.integer >= 0",
  "limit?": "1 <= number.integer <= 100",
  "raw?": "boolean",
}).onUndeclaredKey("reject")

const toMcpSchema = <Schema extends type.Any>(schema: Schema) =>
  z.fromJSONSchema(schema.toJsonSchema())
```

The call-hierarchy operation follows the upstream VS Code interaction
structurally: one required direction and one level. It requests the native
`prepareCallHierarchy` result and the selected native `incomingCalls` or
`outgoingCalls` responses, then presents those fields as text without deriving
new semantic relationships.

```json
{
  "name": "call_hierarchy",
  "arguments": {
    "workspace": "/workspace",
    "file": "src/compiler.ts",
    "position": { "line": 230, "character": 13 },
    "direction": "incoming"
  }
}
```

```txt
Coordinates: LSP — zero-based line and UTF-16 character.
planTensorStorage [variable] selection 230:13-230:30; body 230:13-404:4
  incoming compileTensorTrainingCapability [function] src/capability.ts:582:6-582:37; body 582:40-647:4; call sites 623:27-623:44
```

Every public operation has had a direct result-shape audit. The text renderer
preserves native item ordering, names, kinds, human detail, and authored source
ranges while removing JSON object syntax and provider-routing state. Document
and workspace symbols, references, and completions retain their existing page
or depth controls; `raw` requests the full item set or hierarchy but uses the
same text representation.

A position-bearing result identifies the protocol coordinate basis in its
first line. Document outlines additionally label `selectionRange` as
`selection`, distinguishing the exact symbol target agents should pass to a
subsequent hover, navigation, reference, highlight, or hierarchy request from
the declaration's larger `body` range. The MCP does not search for a requested
symbol name or synthesize a second position model.

```txt
Coordinates: LSP — zero-based line and UTF-16 character.
planTensorStorage [variable] selection 230:13-230:30; body 230:13-404:4
```

Using `{ line: 230, character: 13 }` from that source-level MCP result returned
all eight native references in `kek-monorepo`. This removes the human-line/LSP-
line ambiguity without converting any upstream range.

Reference lookup also composes the hover at the same position, so an adjacent
coordinate exposes the symbol Volar actually resolved rather than presenting a
different result as though it belonged to the intended declaration.

```text
Query: const definePolicyIterationWorkerResult: (input: { — ...:258:13-258:46
1 reference
...:258:13-258:46

Query: const POLICY_ENVIRONMENT_QUALIFICATION_WORKER_RESULT_FORMAT: "..." — ...:257:10-257:63
4 references
...
```

This uses the standard hover range and first human-readable hover line. It does
not parse source, inspect an AST, or guess a nearby token.

Status: installed/upstream-source observed; official MCP stdio client observed.

## Authored semantic locations

Volar preserves globally addressable LSP document identity. Filesystem-backed
projects convert TypeScript filenames into absolute `file:` URIs before a
location crosses the protocol boundary.

```js
// @volar/language-server@2.4.28/lib/project/typescriptProject.js
const isFileScheme = rootFolders.every(folder => folder.scheme === 'file')

if (!isFileScheme) {
  for (const folder of rootFolders) {
    return URI.parse(`${folder.scheme}://${folder.authority}${fileName}`)
  }
}
return URI.file(fileName)
```

The MCP text view uses the request's absolute workspace root to display an
in-workspace file URI as a relative path. Targets outside that root retain their
absolute path, preserving the global identity needed for dependency and
cross-workspace navigation.

```txt
TypeScript config: packages/webgpu-engine/tsconfig.json

planTensorStorage [variable] packages/webgpu-engine/src/domains/learning/framework/compiler/plan-tensor-storage.ts:230:13-404:4
```

Relative display is a client presentation affordance, not a language-server
configuration. The VS Code host exposes the exact editor operation:

```ts
// microsoft/vscode@b7d0a0bb/src/vscode-dts/vscode.d.ts
export function asRelativePath(
  pathOrUri: string | Uri,
  includeWorkspaceFolder?: boolean,
): string
```

`vscode-languageclient` does not apply it to protocol results; its default
converter is `value => vscode.Uri.parse(value)`. The operation therefore
belongs after the LSP response reaches the host. The headless MCP has the same
information through each tool's explicit workspace root and centralizes the
equivalent presentation once:

```ts
// packages/code-intelligence-mcp/src/plain-text.ts
const workspacePath = (uri: string, workspaceRoot: string) => {
  try {
    const parsed = URI.parse(uri)
    if (parsed.scheme !== "file") return uri
    const relative = path.relative(path.resolve(workspaceRoot), parsed.fsPath)
    return relative === "" ? "." : relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      ? relative
      : parsed.fsPath
  }
  catch {
    return uri
  }
}
```

Every formatter that displays a URI calls `workspacePath` or
`workspaceRange`; no tool performs its own path shortening. Non-file URIs and
files outside the requested workspace preserve their globally meaningful
identity. `vscode-uri` provides parsing, filesystem conversion, joining, and
resolution but no root-relative-path function.

Status: installed protocol, language-client, and `vscode-uri` source plus VS
Code API source at revision `b7d0a0bb1c75ffcb5be780fdfe5970a5c2482aec`
inspected; source-level MCP output observed across two workspace roots.

`@volar/source-map` is the offset engine beneath Volar's language features. It
is consumed through `Language.maps`; it is not an independent project scanner.

```ts
// @volar/language-core@2.4.28/lib/types.d.ts
interface Language<T> {
  maps: {
    get(virtualCode: VirtualCode, sourceScript: SourceScript<T>): Mapper
    forEach(virtualCode: VirtualCode): Generator<[SourceScript<T>, Mapper]>
  }
}

interface Mapper {
  toSourceRange(start: number, end: number, fallbackToAnyMatch: boolean, filter?): Generator<...>
  toGeneratedRange(start: number, end: number, fallbackToAnyMatch: boolean, filter?): Generator<...>
  toSourceLocation(offset: number, filter?): Generator<...>
  toGeneratedLocation(offset: number, filter?): Generator<...>
}
```

Each mapper consumes the original mapping segments; transformed regions can
declare different source and generated lengths rather than forcing one-to-one
offset arithmetic.

```ts
// @volar/source-map@2.4.28/lib/sourceMap.d.ts
interface Mapping<Data> {
  sourceOffsets: number[]
  generatedOffsets: number[]
  lengths: number[]
  generatedLengths?: number[]
  data: Data
}
```

When `generatedLengths` is absent, `lengths` applies to both sides. Supplying it
is the native representation for a transformed span whose generated width
differs from its authored width; wrappers and transformed code should express
that difference in mappings instead of compensating for it in MCP coordinates.

The mapping data declares which language features are valid in each generated
region.

```ts
// @volar/language-core@2.4.28/lib/types.d.ts
interface CodeInformation {
  verification?: boolean | { shouldReport?(source, code): boolean }
  completion?: boolean | { isAdditional?: boolean; onlyImport?: boolean }
  semantic?: boolean | { shouldHighlight?(): boolean }
  navigation?: boolean | {
    shouldHighlight?(): boolean
    shouldRename?(): boolean
    resolveRenameNewName?(newName: string): string
    resolveRenameEditText?(newText: string): string
  }
  structure?: boolean
  format?: boolean
}
```

| Mapping field | Volar feature families enabled for that region |
| --- | --- |
| `verification` | Diagnostics and code actions. `shouldReport` filters mapped diagnostic reporting without preventing TypeScript analysis. |
| `completion` | Completion, completion continuation, auto insertion, and signature help. `isAdditional` and `onlyImport` participate in Volar's completion-provider orchestration. |
| `semantic` | Hover, inlay hints, semantic tokens, code lenses, monikers, and inline values. `shouldHighlight` can suppress semantic highlighting for a mapped region. |
| `navigation` | Definition, type definition, implementation, references, document highlights, rename, call hierarchy, and type hierarchy. Its callbacks control highlighting and source/generated rename text. |
| `structure` | Document symbols, folding ranges, selection ranges, linked editing, document colors, and document links. |
| `format` | Document and range formatting over the mapped region. |

These are region-level capabilities, not server-level feature declarations. A
service plugin may implement a feature globally while a specific generated
region remains ineligible because its mapping omits the corresponding field.
The MCP must not retry through lower-level TypeScript APIs when Volar correctly
filters such a region.

Volar's feature worker projects authored positions into virtual documents and
maps results back before the language-server handler returns them.

```js
// @volar/language-service@2.4.28/lib/utils/featureWorkers.js
function* getGeneratedPositions([sourceDocument, embeddedDocument, map], position, filter) {
  for (const [offset] of map.toGeneratedLocation(sourceDocument.offsetAt(position), filter)) {
    yield embeddedDocument.positionAt(offset)
  }
}

function* getSourceRanges([sourceDocument, embeddedDocument, map], range, filter) {
  for (const [start, end] of map.toSourceRange(
    embeddedDocument.offsetAt(range.start),
    embeddedDocument.offsetAt(range.end),
    true,
    filter,
  )) {
    yield { start: sourceDocument.positionAt(start), end: sourceDocument.positionAt(end) }
  }
}
```

Definitions, references, hover, document symbols, selection ranges, call
hierarchy, diagnostics, semantic tokens, code actions, completion, and other
feature implementations call these workers with the appropriate
`CodeInformation` predicate. They also map linked virtual code and deduplicate
the mapped results.

Code-intelligence consequence: MCP operations consume the returned authored
URIs and ranges. They do not construct `SourceMap` instances, translate virtual
offsets, decide feature eligibility, traverse linked code, or deduplicate
general semantic results.

`@volar/test-utils` also exports `printSnapshot`, but its input is an in-memory
`SourceScript` plus `VirtualCode`, not the language-server protocol response.
Its implementation reconstructs a mapper and emits line-oriented test snapshot
annotations. It is useful for language-plugin tests; importing it into the MCP
would bypass the existing Volar editor requests and introduce test-oriented
presentation code into the production runtime.

Status: installed-source observed.

## Associated scripts and linked generated code

Volar models two relationships that are different from ordinary source-to-
generated mappings.

```ts
// @volar/language-core@2.4.28/lib/types.d.ts
interface VirtualCode {
  mappings: CodeMapping[]

  // The same virtual code can map to additional authored source scripts.
  associatedScriptMappings?: Map<unknown, CodeMapping[]>

  // Positions inside generated code can be semantic mirrors of one another.
  linkedCodeMappings?: Mapping[]
}

interface CodegenContext<T> {
  getAssociatedScript(scriptId: T): SourceScript<T> | undefined
}
```

```js
// @volar/language-core@2.4.28/index.js
getAssociatedScript(id) {
  sync(id, true, true)
  const relatedSourceScript = scriptRegistry.get(id)
  if (relatedSourceScript) {
    relatedSourceScript.targetIds.add(sourceScript.id)
    sourceScript.associatedIds.add(relatedSourceScript.id)
  }
  return relatedSourceScript
}

function triggerTargetsDirty(sourceScript) {
  sourceScript.targetIds.forEach(id => {
    const target = scriptRegistry.get(id)
    if (target) {
      target.isAssociationDirty = true
      onAssociationDirty?.(target.id)
    }
  })
}
```

`associatedScriptMappings` lets one generated document return authored ranges
against more than one source script. Calling `getAssociatedScript` also records
dependency edges, so changing or deleting the associated source invalidates
the generated target.

`linkedCodeMappings` instead connects mirrored positions within generated code.
Definition, reference, rename, and related navigation workers can follow those
positions recursively before mapping and deduplicating the result. Neither
relationship should be reproduced as an MCP dependency graph or custom result
traversal.

Status: installed-source observed.

## TypeScript service-script composition

A language plugin chooses whether generated TypeScript replaces the source
file's TypeScript view or appears as additional importable files.

```ts
// @volar/typescript@2.4.28/index.d.ts
interface TypeScriptGenericOptions {
  extraFileExtensions: ts.FileExtensionInfo[]
  resolveHiddenExtensions?: boolean
  getServiceScript(root: VirtualCode): TypeScriptServiceScript | undefined
}

interface TypeScriptNonTSPluginOptions {
  // This hook is intentionally unavailable in TypeScript-plugin mode.
  getExtraServiceScripts?(
    fileName: string,
    root: VirtualCode,
  ): TypeScriptExtraServiceScript[]
}

interface TypeScriptServiceScript {
  code: VirtualCode
  extension: string
  scriptKind: ts.ScriptKind
  preventLeadingOffset?: boolean
}

interface TypeScriptExtraServiceScript extends TypeScriptServiceScript {
  fileName: string
}
```

`getServiceScript` supplies the generated TypeScript view associated with the
source file's own identity. `getExtraServiceScripts` supplies additional file
identities that participate in the project and ordinary TypeScript module
resolution.

```js
// @volar/typescript@2.4.28/lib/protocol/createProject.js
for (const fileName of projectHost.getScriptFileNames()) {
  const sourceScript = language.scripts.get(asScriptId(fileName))
  const typescript = sourceScript?.generated?.languagePlugin.typescript

  const serviceScript = typescript?.getServiceScript(
    sourceScript.generated.root,
  )
  if (serviceScript) {
    tsFileNamesSet.add(fileName)
  }

  for (const extraScript of typescript?.getExtraServiceScripts?.(
    fileName,
    sourceScript.generated.root,
  ) ?? []) {
    tsFileNamesSet.add(extraScript.fileName)
    extraScriptRegistry.set(extraScript.fileName, extraScript)
  }
}

function getScriptSnapshot(fileName) {
  if (extraScriptRegistry.has(fileName)) {
    return extraScriptRegistry.get(fileName).code.snapshot
  }
  // Then resolve a primary service script or an ordinary source snapshot.
}
```

The extra script's `fileName` is its TypeScript module identity and the key in
Volar's case-aware `FileMap`; duplicate normalized names overwrite unless the
language plugin rejects them. Volar also records their parent directories, so
the module-resolution host reports virtual directories without generated files
on disk.

`extraFileExtensions` participates in TypeScript config parsing and directory
reads. The protocol host adds those extensions and enables
`allowNonTsExtensions`; `resolveHiddenExtensions` additionally lets a custom
source extension satisfy a requested `.d.ts` path when its service script is
available.

```js
// volar-service-typescript@0.0.71/lib/plugins/semantic.js
function fileNameToUri(fileName) {
  const extraScript = getExtraServiceScript(fileName)
  if (extraScript) {
    const sourceScript = context.language.scripts.fromVirtualCode(
      extraScript.code,
    )
    return context.encodeEmbeddedDocumentUri(
      sourceScript.id,
      extraScript.code.id,
    )
  }

  const uri = uriConverter.asUri(fileName)
  const sourceScript = context.language.scripts.get(uri)
  const serviceScript = sourceScript?.generated?.languagePlugin.typescript
    ?.getServiceScript(sourceScript.generated.root)
  return sourceScript && serviceScript
    ? context.encodeEmbeddedDocumentUri(sourceScript.id, serviceScript.code.id)
    : uri
}
```

This identity bridge is why definitions, references, diagnostics, and edits for
service scripts return through Volar's embedded-document mapping instead of
leaking generated filenames. The MCP should consume the mapped LSP result; it
does not need to understand either service-script registry.

Status: installed-source observed.

## TypeScript project and virtual-code context

The generic language server already uses `@volar/typescript` through Volar's
standard project implementation.

```js
// @volar/language-server@2.4.28/lib/project/typescriptProjectLs.js
const sys = createSys(ts.sys, serviceEnv, getCurrentDirectory, uriConverter)

const project = {
  typescript: {
    configFileName: typeof tsconfig === "string" ? tsconfig : undefined,
    sys,
    uriConverter,
    ...createLanguageServiceHost(ts, sys, language, uriConverter.asUri, projectHost),
  },
}
```

`volar-service-typescript` consumes that project context to create the actual
TypeScript language service and translate between source, service-script, and
embedded-document identities.

```js
// volar-service-typescript@0.0.71/lib/plugins/semantic.js
if (!context.project.typescript) return {}

const {
  sys,
  languageServiceHost,
  uriConverter,
  getExtraServiceScript,
} = context.project.typescript

const languageService = ts.createLanguageService(languageServiceHost, documentRegistry)
```

The semantic service also publishes its raw TypeScript objects through Volar's
service-context injection mechanism.

```ts
// volar-service-typescript@0.0.71/lib/plugins/semantic.d.ts
interface Provide {
  "typescript/languageService": () => ts.LanguageService
  "typescript/languageServiceHost": () => ts.LanguageServiceHost
  "typescript/documentFileName": (uri: URI) => string
  "typescript/documentUri": (fileName: string) => URI
}
```

This is an internal composition affordance for service plugins. MCP navigation
continues through LSP because Volar's handlers already apply virtual-code
routing, feature eligibility, authored-range mapping, cancellation, and result
deduplication. Direct injection is justified only for a capability that the
complete Volar/LSP surface does not expose.

Dependency-source discovery has that narrow protocol gap, but module resolution
itself does not. The language server selects the document's Volar project and
injects its TypeScript language service, host, and document filename from
`volar-service-typescript`.

```ts
const sourceFile = languageService.getProgram()?.getSourceFile(fileName)
const options = host.getCompilationSettings()

const source = ts.resolveModuleName(
  moduleName,
  fileName,
  { ...options, noDtsResolution: true },
  host,
  undefined,
  undefined,
  sourceFile?.impliedNodeFormat,
).resolvedModule

const resolved = source ?? ts.resolveModuleName(
  moduleName,
  fileName,
  options,
  host,
  host.getModuleResolutionCache?.(),
  undefined,
  sourceFile?.impliedNodeFormat,
).resolvedModule
```

TypeScript's standard resolver therefore runs over Volar's active filesystem,
compiler settings and the consumer source file's native module mode.
`noDtsResolution` is TypeScript's own switch for resolving implementation files
instead of preferring declarations; that source lookup cannot reuse the
project's module cache because it intentionally changes the compiler options.
Declaration-only packages use a second standard lookup with the unmodified
project options and module cache. `LanguageServiceHost.resolveModuleNames` is
deprecated. `resolveModuleNameLiterals` is intended for real import AST nodes
and `@volar/typescript` calls `getModeForUsageLocation` on those nodes;
fabricating one for an arbitrary package-search input would counterfeit source
context.
The native result supplies `resolvedFileName` and `packageId`
(`name`, `subModuleName`, exact `version`, and peer identity). The MCP does not
resolve packages, read manifests or lockfiles, or traverse `node_modules`; it
only selects the package-local distribution directory that Semble indexes.
Native identity is authoritative. `diff` resolves to its consumer-visible
runtime distribution at `diff@7.0.0`; an explicit or declaration-only
`@types/diff` request resolves to `@types/diff@7.0.2`.

TypeScript derives `subModuleName` from the resolved file and the package
directory it already discovered:

```js
// typescript@5.9.3/lib/typescript.js — withPackageId
subModuleName:
  r.path.slice(packageInfo.packageDirectory.length + directorySeparator.length)
```

Semble always ignores nested `dist/` and `build/` directories. Dependency search
therefore uses the first directory component of that native relative path as
the Semble repository root; making the distribution directory itself the root
keeps its contents eligible without overriding Semble's index policy. A
root-level resolved file uses the package directory directly. This path
selection is the only dependency-layout responsibility outside Volar and
Semble.

One official MCP client kept the same stdio process alive while a disposable
TypeScript workspace changed from having no `arktype` dependency to installing
`arktype@2.2.3` with pnpm. The first dependency search returned the native
unresolved result; the next call, without notification or restart, resolved and
searched the new runtime distribution. A separate call resolved `diff@7.0.0`
and `@types/diff@7.0.2` independently, confirming the implementation/declaration
selection.

Status: installed-source and official-client stdio behavior observed.

The same project context already has a Volar-native request for identifying the
configured project that owns a document.

```js
// @volar/language-server@2.4.28/lib/features/editorFeatures.js
connection.onRequest(GetMatchTsConfigRequest.type, async ({ uri }) => {
  const languageService = await project.getLanguageService(URI.parse(uri))
  const tsProject = languageService.context.project.typescript
  if (tsProject?.configFileName) {
    return { uri: tsProject.uriConverter.asUri(tsProject.configFileName).toString() }
  }
})
```

Volar's editor protocol also exposes the generated-code tree, generated
content, and the existing language-core mappings.

```js
// @volar/language-server@2.4.28/lib/features/editorFeatures.js
connection.onRequest(GetVirtualFileRequest.type, async ({ uri }) => {
  const languageService = await project.getLanguageService(URI.parse(uri))
  const sourceScript = languageService.context.language.scripts.get(URI.parse(uri))
  return sourceScript?.generated ? prune(sourceScript.generated.root) : undefined
})

connection.onRequest(GetVirtualCodeRequest.type, async ({ fileUri, virtualCodeId }) => {
  const languageService = await project.getLanguageService(URI.parse(fileUri))
  const sourceScript = languageService.context.language.scripts.get(URI.parse(fileUri))
  const virtualCode = sourceScript?.generated?.embeddedCodes.get(virtualCodeId)
  if (virtualCode) {
    const mappings = {}
    for (const [sourceScript, map] of languageService.context.language.maps.forEach(virtualCode)) {
      mappings[sourceScript.id.toString()] = map.mappings
    }
    return {
      content: virtualCode.snapshot.getText(0, virtualCode.snapshot.getLength()),
      mappings,
    }
  }
})
```

Observed against `packages/code-intelligence-language-server/src/server.ts`:

```json
{
  "matchedTsConfig": "packages/code-intelligence-language-server/tsconfig.json",
  "virtualFile": null,
  "servicePlugins": [
    "typescript-semantic",
    "typescript-syntactic",
    "typescript-doc-comment-template",
    "typescript-directive-comment"
  ]
}
```

The virtual-file result is correctly empty because the generic server supplies
no language plugin that generates virtual code. When a configured language
plugin does generate code, the existing requests above expose it; no custom
project, program, or mapping protocol is required.

`@volar/kit` composes `createLanguage`, `createLanguageServiceHost`, and
`createLanguageService` for checker-style consumers and returns `check`,
`fixErrors`, `getRootFileNames`, `language`, and explicit
`fileCreated`/`fileUpdated`/`fileDeleted` inputs. It requires the caller to pick
a tsconfig or supply inferred root files and does not expose the full standard
LSP feature surface. The language-server project remains the upstream
composition for multi-project semantic navigation; kit is evidence that the
same language and project contexts are public, not a replacement runtime for
this MCP. Its returned checker has no `dispose`, `shutdown`, or process-lifetime
operation, and its filesystem snapshots are module-scoped. It therefore does
not provide a lifecycle boundary that could replace graceful language-server
process release.

Status: installed-source observed; direct LSP requests observed.

## Language-plugin virtual-code lifecycle

`@volar/language-core` owns virtual-code creation, incremental replacement,
embedded-code indexing, and disposal. A language plugin can update an existing
root or let Volar recreate it from the new snapshot.

```ts
// @volar/language-core@2.4.28/lib/types.d.ts
interface LanguagePlugin<T, K extends VirtualCode> {
  // Closed filesystem documents have no language id supplied by an editor.
  getLanguageId(scriptId: T): string | undefined
  createVirtualCode?(
    scriptId: T,
    languageId: string,
    snapshot: IScriptSnapshot,
    context: CodegenContext<T>,
  ): K | undefined
  updateVirtualCode?(
    scriptId: T,
    virtualCode: K,
    snapshot: IScriptSnapshot,
    context: CodegenContext<T>,
  ): K | undefined
  disposeVirtualCode?(scriptId: T, virtualCode: K): void
}
```

`getLanguageId` is therefore part of disk-backed operation, not just editor
registration. The generic server already appends Volar's standard TypeScript,
JavaScript, JSX/TSX, and JSON resolver; a custom language plugin owns only its
additional source identities.

```js
// @volar/language-core@2.4.28/index.js
const { updateVirtualCode, createVirtualCode } = sourceScript.generated.languagePlugin
const newVirtualCode = updateVirtualCode
  ? updateVirtualCode(id, sourceScript.generated.root, snapshot, codegenCtx)
  : createVirtualCode?.(id, languageId, snapshot, codegenCtx)

sourceScript.generated.root = newVirtualCode
sourceScript.generated.embeddedCodes.clear()
for (const code of forEachEmbeddedCode(newVirtualCode)) {
  virtualCodeToSourceScriptMap.set(code, sourceScript)
  sourceScript.generated.embeddedCodes.set(code.id, code)
}

// Language.scripts.delete(...)
sourceScript.generated?.languagePlugin.disposeVirtualCode?.(
  id,
  sourceScript.generated.root,
)
```

The embedded-code index is rebuilt after either update path, so request routing
does not require a second registry in a language server or MCP. Implement
`updateVirtualCode` only when preserving parser/codegen state across snapshots
is useful; recreation is already the native behavior when the hook is absent.

The `VirtualCode.id` is also embedded-document identity. Volar indexes each
generated code by that value, includes it in `volar-embedded-content` URIs, and
uses it for virtual-code inspection requests. A language plugin therefore owns
stable IDs across updates. The captured MDX reference preserves its ordinary
virtual IDs when parsing fails and disables mapping by returning empty arrays:

```js
// mdx-js/mdx-analyzer@660067a
// packages/language-service/lib/virtual-code.js
try {
  this.embeddedCodes = getEmbeddedCodes(source, processor.parse(source))
}
catch (error) {
  this.error = error
  this.embeddedCodes = [
    { id: 'jsx', languageId: 'javascriptreact', mappings: [] },
    { id: 'md', languageId: 'markdown', mappings: [] },
  ]
}
```

For recoverable parser failures, this keeps embedded-document identity stable
without claiming that invalid regions remain semantically mapped. Volar will
rebuild its index from the reduced tree returned by the plugin.

Status: installed identity contract observed; reference-source recovery pattern
captured.

## Agent observability workflow inventory

The authoritative surface is the intersection of Volar's generic language
service and the capabilities advertised by the installed
`volar-service-typescript` plugins. A broad LSP initialization against the
source server returned this capability set:

```json
{
  "selectionRangeProvider": true,
  "foldingRangeProvider": true,
  "documentSymbolProvider": true,
  "referencesProvider": true,
  "implementationProvider": true,
  "definitionProvider": true,
  "typeDefinitionProvider": true,
  "callHierarchyProvider": true,
  "hoverProvider": true,
  "documentHighlightProvider": true,
  "workspaceSymbolProvider": {},
  "renameProvider": { "prepareProvider": true },
  "inlayHintProvider": {},
  "signatureHelpProvider": {
    "triggerCharacters": ["(", ",", "<"],
    "retriggerCharacters": [")"]
  },
  "completionProvider": { "resolveProvider": true },
  "semanticTokensProvider": { "full": true, "range": true },
  "codeActionProvider": { "resolveProvider": true }
}
```

The same initialization also advertised document, range, and on-type formatting
plus experimental auto-insertion, file-rename edits, and file references. Those
are editing affordances rather than observability results and remain accounted
for separately.

The headless client advertises the editor result forms it can consume, including
completion item capabilities, definition/type-definition/implementation links,
Markdown hover and signature content, hierarchical symbols, inlay hints,
diagnostics, and call hierarchy.

```ts
// packages/code-intelligence-mcp/src/language-client.ts
export const clientCapabilities = {
  workspace: {
    configuration: true,
    didChangeWatchedFiles: { dynamicRegistration: true },
    symbol: {
      symbolKind: { valueSet: symbolKinds },
      tagSupport: { valueSet: symbolTags },
    },
  },
  textDocument: {
    callHierarchy: {},
    completion: {
      completionItemKind: { valueSet: completionItemKinds },
      completionItem: { /* supported result forms */ },
    },
    definition: { linkSupport: true },
    diagnostic: { relatedDocumentSupport: true },
    documentHighlight: {},
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: { valueSet: symbolKinds },
      tagSupport: { valueSet: symbolTags },
    },
    hover: { contentFormat: ["markdown", "plaintext"] },
    implementation: { linkSupport: true },
    inlayHint: {},
    references: {},
    signatureHelp: { /* supported result forms */ },
    typeDefinition: { linkSupport: true },
  },
  general: { positionEncodings: ["utf-16"] },
} satisfies ClientCapabilities
```

Client capabilities affect result fidelity: definition-link support preserves
origin and target selections; completion snippet and insert/replace support
prevent server downgrades; and Markdown capability preserves readable hover and
signature content. Capabilities with client obligations are advertised only
when the MCP implements those obligations. The public MCP surface then selects
the high-value human observability requests from the activated server surface.

## LSP client capability and configuration negotiation

The headless client serves Volar's standard `workspace/configuration` request.
Configuration lookup is path-based, so the service receives the same
`typescript.*` and `javascript.*` setting shapes it requests from an editor.

```ts
// packages/code-intelligence-mcp/src/volar-workspace.ts
connection.onRequest(ConfigurationRequest.type, ({ items }) =>
  items.map(({ section }) => getClientConfiguration(section))
)

// packages/code-intelligence-mcp/src/language-client.ts
export const getClientConfiguration = (section: string | undefined) => {
  if (!section) return null
  const [language, ...path] = section.split(".")
  const root = configurations[language as keyof typeof configurations]
  return path.reduce(
    (value, key) => typeof value === "object" && key in value
      ? value[key]
      : undefined,
    root,
  ) ?? null
}
```

The installed TypeScript service consumes these standard configuration
sections. Each one is an independently reusable affordance of the service.

| Installed consumer | Requested section | Affordance |
| --- | --- | --- |
| `volar-service-typescript/lib/plugins/semantic.js` | `<language>.validate.enable` | Enables document diagnostics per language. |
| Same plugin | `<language>.suggest.enabled` | Enables completion discovery per language. |
| Same plugin during completion resolve | `<language>.suggest.completeFunctionCalls` | Produces callable snippets when TypeScript permits them. |
| `lib/configs/getUserPreferences.js` | `<language>` | Configures auto-import candidates, completion snippets, label details, JSDoc display, and every TypeScript inlay-hint category. |
| `typescript-auto-import-cache` integration | `typescript.preferences` | Updates import-specifier and package-auto-import preferences used by the auto-import cache. |
| `@volar/language-server/lib/project/inferredCompilerOptions.js` | `js/ts.implicitProjectConfig` and `javascript.implicitProjectConfig` | Configures checking and compiler semantics for source files owned by inferred projects. |

The client capability object contains two different categories. Some fields
change the response Volar sends; others only declare lifecycle behavior.

```js
// @volar/language-server@2.4.28/lib/features/languageFeatures.js
const snippetSupport = initializeParams.capabilities
  .textDocument?.completion?.completionItem?.snippetSupport
const insertReplaceSupport = initializeParams.capabilities
  .textDocument?.completion?.completionItem?.insertReplaceSupport ?? false

const linkSupport = initializeParams.capabilities
  .textDocument?.[type]?.linkSupport ?? false

const supportsDiagnosticPull =
  !!initializeParams.capabilities.workspace?.diagnostics
```

Those response-shaping paths are active in the headless client:

- completion preserves snippets, commit characters, documentation, tags,
  insert/replace edits, label details, and supported `CompletionList` defaults;
- definition, type-definition, and implementation preserve `LocationLink`
  origin and target ranges;
- pull diagnostics preserve related documents, related information, tags, code
  descriptions, and provider data;
- hover and signature help request Markdown before plaintext;
- document symbols request the hierarchical result form.

Refresh capabilities describe client lifecycle behavior rather than cached
semantic state in the server. Volar requests these two standard refreshes after
a watched source edit.

```ts
// packages/code-intelligence-mcp/src/language-client.ts
workspace: {
  inlayHint: { refreshSupport: true },
  semanticTokens: { refreshSupport: true },
}

// packages/code-intelligence-mcp/src/volar-workspace.ts
connection.onRequest(InlayHintRefreshRequest.type, () => undefined)
connection.onRequest(SemanticTokensRefreshRequest.type, () => undefined)
```

The headless client has no displayed editor cache to refresh. Acknowledging the
requests is therefore the complete host action; subsequent MCP calls pull fresh
results. Without these capabilities Volar emitted unsupported-capability
warnings after an observed source edit.

The client does advertise every standard completion and symbol kind plus
deprecated-symbol tags because its text renderer handles those values. The
UTF-16 position encoding makes the handshake and public MCP coordinate contract
explicit.

```js
// volar-service-typescript@0.0.71/lib/plugins/semantic.js
capabilities: {
  inlayHintProvider: {},
  workspaceSymbolProvider: {},
  completionProvider: { resolveProvider: true },
}
```

`@volar/vscode` exposes the standard `vscode-languageclient/node` client entry
point, so editor hosts use the same LSP capability and configuration contracts.

Status: installed-source observed; diagnostics, inlay hints, completion,
navigation links, hierarchical symbols, hover, and signature help observed
through the official MCP client over stdio.

### Completion orchestration is already upstream

Volar owns multi-service completion ordering, virtual-document mapping,
incomplete-result continuation, and the provider identity needed for resolution.

```js
// @volar/language-service@2.4.28/lib/features/provideCompletionItems.js
return async (uri, position, completionContext = { triggerKind: 1 }, token) => {
  if (completionContext.triggerKind === 3 && lastResult?.uri.toString() === uri.toString()) {
    // Re-run only providers whose previous list was incomplete.
  }

  const sortedPlugins = [...context.plugins]
    .sort((a, b) => sortServices(a[1], b[1]))

  for (const item of completionList.items) {
    item.data = {
      uri: uri.toString(),
      original: {
        additionalTextEdits: item.additionalTextEdits,
        textEdit: item.textEdit,
        data: item.data,
      },
      pluginIndex,
      embeddedDocumentUri: docs ? document.uri : undefined,
    }
  }
}
```

Completion-list defaults also participate in Volar's source mapping and service
composition.

```js
// @volar/language-service@2.4.28/lib/utils/transform.js
return {
  isIncomplete: completionList.isIncomplete,
  itemDefaults: completionList.itemDefaults
    ? {
        ...completionList.itemDefaults,
        editRange: completionList.itemDefaults.editRange
          ? 'replace' in completionList.itemDefaults.editRange
            ? {
                insert: getOtherRange(completionList.itemDefaults.editRange.insert),
                replace: getOtherRange(completionList.itemDefaults.editRange.replace),
              }
            : getOtherRange(completionList.itemDefaults.editRange)
          : undefined,
      }
    : undefined,
  items: completionList.items.map(item =>
    transformCompletionItem(item, getOtherRange, document, context)),
}

// @volar/language-service@2.4.28/lib/features/provideCompletionItems.js
return {
  isIncomplete: lists.some(list => list?.isIncomplete),
  itemDefaults: lists.find(list => list?.itemDefaults)?.itemDefaults,
  items: lists.flatMap(list => list?.items ?? []),
}
```

The client advertises `CompletionList.itemDefaults.editRange`, and the text view
reports that inherited edit range once above the affected completion items.

The language server keeps the language service that produced the most recent
completion list and resolves through that same service.

```js
// @volar/language-server@2.4.28/lib/features/languageFeatures.js
lastCompleteUri = params.textDocument.uri
lastCompleteLs = languageService

server.connection.onCompletionResolve(async (item, token) => {
  if (lastCompleteUri && lastCompleteLs) {
    item = await lastCompleteLs.resolveCompletionItem(item, token)
  }
  return item
})
```

Completion discovery and requested resolution stay on one LSP connection.
Provider `data` identifies the originating service and embedded document for
resolution. An incomplete-list continuation uses the standard completion
trigger kind `3`, allowing Volar to rerun only providers whose previous lists
were incomplete.

Status: installed-source observed; completion and page resolution observed over
one official MCP stdio session.

### Diagnostic requests and related-document progress

The TypeScript plugin declares inter-file dependencies. Volar therefore chooses
editor push diagnostics even when the client advertises workspace diagnostic
support, but it still installs the standard document-diagnostic request.

```js
// @volar/language-server@2.4.28/lib/features/languageFeatures.js
if (supportsDiagnosticPull && !interFileDependencies) {
  serverCapabilities.diagnosticProvider = { /* ... */ }
}
else {
  documents.onDidChangeContent(/* publish affected open documents */)
}

server.connection.languages.diagnostics.on(async (params, token, _, progress) => {
  const result = await languageService.getDiagnostics(uri, errors => {
    progress?.report({
      relatedDocuments: {
        [params.textDocument.uri]: { kind: "full", items: errors },
      },
    })
  }, token)
  return { kind: "full", items: result ?? [] }
})
```

The standard document-diagnostic request returns the requested document's full
item list. When the caller supplies a partial-result token, Volar can also
stream intermediate diagnostic batches for that same requested URI under the
protocol's `relatedDocuments` progress shape. The installed handler keys every
reported batch by `params.textDocument.uri`; it does not enumerate other
affected documents. The final response already contains the requested
document's complete diagnostics, so the MCP does not need progress aggregation
to preserve result fidelity.

Status: installed-source observed; error, hint, related-information, tag, and
empty final reports observed through the official MCP client over stdio.

The same native request can accompany a file-scoped observation without
changing the primary result.

```ts
// packages/code-intelligence-mcp/src/tools.ts
const diagnosticContext = requestDiagnosticContext(
  workspace,
  textDocument,
  root,
  includeDiagnostics,
  signal,
  position,
)
const hover = await workspace.sendRequest(HoverRequest.type, {
  textDocument,
  position,
}, signal)

return appendDiagnosticContext(
  coordinateTextResult(formatHover(textDocument.uri, hover, root)),
  await diagnosticContext,
)
```

```text
packages/code-intelligence-mcp/src/ambient-diagnostics.tmp.ts:2:13-2:18

(parameter) count: number

Diagnostics · packages/code-intelligence-mcp/src/ambient-diagnostics.tmp.ts
1 error
error ts(2322) 2:13-2:18
  Type 'number' is not assignable to type 'string'.
Use the diagnostics tool for the complete report.
```

Clear documents add no second content block. File-wide observations report
only error and warning totals; position- and range-based observations include
one intersecting diagnostic. `includeDiagnostics: false` preserves the primary
result exactly. The explicit `diagnostics` tool remains the complete report.

Status: runtime-proven through one official source-level MCP stdio session;
same-session edit removed the diagnostic block without restart or notification.

### TypeScript inlay and workspace-symbol result shapes

The active TypeScript service converts TypeScript results directly into the LSP
fields the MCP receives.

```js
// volar-service-typescript@0.0.71/lib/utils/lspConverters.js
function convertInlayHint(hint, document) {
  return {
    position: document.positionAt(hint.position),
    label: hint.text,
    kind: hint.kind === "Type" ? 1 : hint.kind === "Parameter" ? 2 : undefined,
    paddingLeft: hint.whitespaceBefore,
    paddingRight: hint.whitespaceAfter,
  }
}

function convertNavigateToItem(item, document) {
  const info = {
    name: getLabel(item),
    kind: convertScriptElementKind(item.kind),
    location: { uri: document.uri, range: convertTextSpan(item.textSpan, document) },
  }
  if (parseKindModifier(item.kindModifiers)?.has("deprecated")) {
    info.tags = [1]
  }
  return info
}
```

TypeScript inlay hints provide position, human label, kind, and visual padding.
Workspace symbols provide names, kinds, exact authored ranges, and deprecation
tags.

The request range bounds TypeScript's analysis input, not necessarily every
returned position. A request for `237:0-243:0` in
`plan-tensor-storage.ts` also returned the enclosing function's inferred type at
`230:30`, followed by the hints inside the requested body. The MCP preserves
that upstream result rather than filtering an enclosing declaration that
provides useful type context.

```txt
type 230:30 — : (program: ReverseTensorProgram, options?: ...) => Effect<...>
parameter 237:13 — f:
type 237:25 — : Generator<...>
```

Status: installed-source observed; inlay types/parameters and workspace-symbol
locations observed through the official MCP client over stdio.

### Workspace roots and inferred projects are separate affordances

Initial roots come from initialize parameters regardless of whether the client
advertises support for later workspace-folder changes.

```js
// @volar/language-server@2.4.28/lib/features/workspaceFolders.js
if (initializeParams.workspaceFolders?.length) {
  for (const folder of initializeParams.workspaceFolders) folders.set(URI.parse(folder.uri), true)
}
else if (initializeParams.rootUri) {
  folders.set(URI.parse(initializeParams.rootUri), true)
}

if (initializeParams.capabilities.workspace?.workspaceFolders) {
  connection.workspace.onDidChangeWorkspaceFolders(/* reload on change */)
}
```

Configured-project routing then scans ancestor `tsconfig.json` and
`jsconfig.json` files, prefers direct inclusion, and follows project-reference
chains for indirect inclusion. If no configuration owns the file, Volar creates
one inferred project per workspace folder and calls `tryAddFile` for each
requested source.

The initialization parameters establish the initial workspace set. Advertising
the `workspaceFolders` client capability additionally activates standard
`workspace/didChangeWorkspaceFolders` handling and reloads project ownership
when that set changes.

Status: installed-source observed; configured project selection observed across
multiple package roots.

### Reference lookup is scoped to one selected project

The standard reference handler resolves exactly one language service for the
requested URI.

```js
// @volar/language-server@2.4.28/lib/features/languageFeatures.js
connection.onReferences(async (params, token) => {
  const uri = URI.parse(params.textDocument.uri)
  return worker(uri, token, languageService =>
    languageService.getReferences(uri, params.position, { includeDeclaration: true }, token)
  )
})

function worker(uri, token, callback) {
  const languageService = await server.project.getLanguageService(uri)
  return callback(languageService)
}
```

`createTypeScriptProject` chooses a directly including configuration before an
outer configuration or an indirectly consuming project.

```js
// @volar/language-server@2.4.28/lib/project/typescriptProject.js
async getLanguageService(uri) {
  const tsconfig = await findMatchTSConfig(server, uri)
  if (tsconfig) {
    const project = await getOrCreateConfiguredProject(server, tsconfig)
    return project.languageService
  }
}

return await findDirectIncludeTsconfig()
  ?? await findIndirectReferenceTsconfig()
```

```text
references(
  packages/webgpu-engine/.../policy-operation-worker-result.ts,
  258:13
)
1 reference
packages/webgpu-engine/.../policy-operation-worker-result.ts:258:13-258:46

project_config(declaration)
TypeScript config: packages/webgpu-engine/tsconfig.json

project_config(consumer)
TypeScript config: apps/traffic-policy-simulator/tsconfig.json
```

The consumer imports and calls the symbol from a different configured project,
so the native result is complete only for the selected project. The MCP labels
that scope explicitly. `getExistingLanguageServices()` exposes services already
created during the session, but it neither discovers every workspace project
nor makes a partial loaded-project set workspace-complete.

Status: installed-source observed; cross-project omission reproduced through
the session-attached MCP on `kek-monorepo`.

Workspace symbols use a different upstream scope: every language service
already created in the session.

```js
// @volar/language-server@2.4.28/lib/features/languageFeatures.js
connection.onWorkspaceSymbol(async (params, token) => {
  const languageServices = await project.getExistingLanguageServices()
  const symbols = []
  for (const languageService of languageServices) {
    symbols.push(...await languageService.getWorkspaceSymbols(params.query, token))
  }
  return symbols
})
```

The MCP activates the anchor file's project before the request and labels the
result as loaded-project scope. It does not describe that session-dependent set
as one selected project or as the complete workspace.

### Active TypeScript observability contracts

| Editor information | Server request or notification | Native result designed for the editor | Current evidence |
| --- | --- | --- | --- |
| Problems for a document | `textDocument/diagnostic` | Full requested-document report: exact range, severity, message, source, code, tags, related information, and provider data | Empty and error-bearing reports observed through official MCP stdio client |
| File outline | `textDocument/documentSymbol` | Hierarchical `DocumentSymbol[]`: name, detail, kind, full range, selection range, tags, children | Official MCP stdio client observed; top-level default and explicit nested depth observed |
| Foldable structure | `textDocument/foldingRange` | `FoldingRange[]`: start/end coordinates, kind, optional collapsed text | Installed source; runtime shape pending |
| Type and documentation at a position | `textDocument/hover` | `Hover`: Markdown or marked-string contents plus optional exact range | Official MCP stdio client observed |
| Declaration navigation | definition, type-definition, and implementation requests | `LocationLink[]`: origin selection, target URI, target body range, target identifier range | All three requests observed through official MCP stdio client |
| Symbol usages | `textDocument/references` | `Location[]`: authored URI and exact usage range within the selected TypeScript project | Paged project-scoped payloads observed; a reverse consumer in another configured project is omitted |
| Module/file consumers | `volar/client/findFileReference` | `Location[]`: authored URI and exact module-specifier range | Paged result observed through official MCP stdio client on `packages/webgpu-engine` |
| Same-file usages | `textDocument/documentHighlight` | `DocumentHighlight[]`: exact range plus read/write/text kind | Read and write usages observed through official MCP stdio client |
| Incoming and outgoing calls | call-hierarchy prepare/incoming/outgoing | Native hierarchy items plus exact `fromRanges` | Both directions observed through official MCP stdio client |
| Named loaded-project symbols | `workspace/symbol` | `WorkspaceSymbol[]`: name, kind, container, location, tags, provider data from every language service already activated in the session | Ten-item default page and complete loaded-project payload observed through official MCP stdio client |
| Call-site parameter information | `textDocument/signatureHelp` | `SignatureHelp`: overload labels and docs, parameter labels/docs, active signature and parameter | Official MCP stdio client observed |
| Contextual API candidates | completion and completion resolve | `CompletionList` and resolved `CompletionItem`: label, kind, detail, docs, edits, command, provider data, incompleteness | Paged and complete results observed through official MCP stdio client |
| Inline inferred annotations | `textDocument/inlayHint` | Active TypeScript result: position, label, type/parameter kind, and padding. The generic LSP shape also permits tooltip, edits, and composite labels when another provider supplies them. | Type and parameter hints observed through official MCP stdio client |
| Nested syntactic selection | `textDocument/selectionRange` | A position-anchored parent chain of successively larger authored ranges | Initialization and installed provider source observed |
| Semantic classification | full or ranged semantic tokens | Relative integer token stream interpreted with the advertised token-type and modifier legend | Installed source; runtime shape pending |
| Available fixes and refactors | code-action and code-action resolve | `CodeAction[]`: title, kind, diagnostics, preference/disabled state, edit, command, provider data | Installed source; runtime shape pending |
| Owning TypeScript project | `volar/client/tsconfig` | `{ uri }` for the selected configuration | Multiple package roots observed through official MCP stdio client |
| Generated document topology | Volar virtual-file and virtual-code requests | Virtual-code tree; generated content; authored `CodeMapping[]` grouped by source URI | Plain TypeScript correctly returned no virtual file; generated-language runtime shape pending |
| Active service contributions | `volar/client/servicePlugins` | Plugin id, name, disabled state, and provided feature method names | TypeScript semantic, syntactic, doc-comment, and directive-comment services observed directly |

### Agent-value ranking of active TypeScript affordances

The ranking is for the active TypeScript service, not for every extension point
implemented by generic Volar packages.

| Rank | Affordance | Agent value and next action | Token/latency profile | Ambiguity and composition | Surface decision |
| --- | --- | --- | --- | --- | --- |
| 1 | Document diagnostics | Identifies an exact problem, range, code, and related locations; directly determines the next inspection or edit. | Usually short; one project startup. | Native related information preserves cross-file context. | Public, direct text view |
| 2 | Hover, definition, type definition, implementation | Answers what a symbol is and where its authored contracts and implementations live. | Compact and position-bounded. | `LocationLink` preserves origin, body, and identifier ranges instead of collapsing matches. | Public, literal result |
| 3 | Document and workspace symbols | Orients in an unfamiliar file or activated project and supplies editable declaration ranges. | Native hierarchies/searches can be large; the top-level outline and ten-result search page are defaults. | Native hierarchy, container names, and TypeScript ordering remain intact; workspace-symbol scope is the set of language services activated in the session. | Public, bounded default; explicit expansion with scope label |
| 4 | References, file references, and document highlights | Establishes project-scoped symbol usage, module-consumer impact, and same-file read/write behavior before an edit or file move. | Symbol and file references are paged; highlights are naturally document-bounded. | Volar already maps authored ranges; reference and file-reference completeness is bounded by the selected TypeScript project and must be labeled. | Public, literal items within a page plus explicit project scope |
| 5 | Call hierarchy | Exposes direct callers or callees plus exact call-site ranges. | One requested direction and level; output grows with fan-in/fan-out. | Native prepare items and per-item relations preserve overload and routing data. | Public, progressive native composition |
| 6 | Signature help and resolved completion | Reveals overloads, parameters, API candidates, documentation, and insertion edits while authoring. | Base completion is paged and unresolved; upstream resolution is explicit for one returned page. | TypeScript ordering is preserved; no MCP candidate scoring is added. | Public; expensive resolution opt-in |
| 7 | Project configuration | Explains which configured or inferred TypeScript project owns a file. | One path or inferred-project statement. | Composes with every project-scoped observation and exposes routing mistakes. | Public, direct text view |
| 8 | Inlay hints | Makes inferred parameter, variable, property, and return types visible across a bounded range. | Range-bounded but can be verbose. | Native positions and hint kinds preserve editor meaning. | Public, caller-bounded |

The TypeScript plugin declares `interFileDependencies: true`, so Volar does not
advertise pull diagnostics to conventional editor clients. The language server
still registers the standard document-diagnostic request handler. The MCP calls
that handler directly and returns the native report; there is no separate
diagnostic implementation or result model.

```js
// volar-service-typescript/lib/plugins/semantic.js
diagnosticProvider: {
  interFileDependencies: true,
  workspaceDiagnostics: false,
}

// @volar/language-server/lib/features/languageFeatures.js
server.connection.languages.diagnostics.on(async params => ({
  kind: DocumentDiagnosticReportKind.Full,
  items: await languageService.getDiagnostics(uri),
}))
```

### `@volar/typescript` ownership

The code-intelligence runtime uses `@volar/typescript` through
`@volar/language-server`'s standard TypeScript project composition. It is not an
unused optional layer. `createTypeScriptProject` delegates configured and
inferred project creation to `createTypeScriptLS`, which imports
`createSys` and `createLanguageServiceHost` from `@volar/typescript`.

```js
// @volar/language-server/lib/project/typescriptProjectLs.js
const { createSys, createLanguageServiceHost } = require('@volar/typescript')

const sys = createSys(ts.sys, serviceEnv, getCurrentDirectory, uriConverter)
const project = {
  typescript: {
    configFileName,
    sys,
    uriConverter,
    ...createLanguageServiceHost(
      ts,
      sys,
      language,
      fileName => uriConverter.asUri(fileName),
      projectHost,
    ),
  },
}
```

`createSys` adapts Volar's language-service filesystem and watched-file event
contract into a versioned TypeScript `System`. `createLanguageServiceHost`
owns script registries and snapshots, project versioning, virtual service
scripts, extra file extensions, and language-plugin-aware module resolution.
`volar-service-typescript` consumes that project context and contributes the
human-facing LSP providers. Other `@volar/typescript` entry points support
TypeScript server plugins, `tsc`/program proxies, and lower-level project
construction. The MCP uses the package through the standard
`createTypeScriptProject` composition so observations share Volar's active
project, filesystem, virtual-code, and module-resolution state.

Status: installed dependency graph, JavaScript implementation, and project
selection/runtime behavior observed.

`@volar/typescript` does not add workspace project discovery to this protocol
composition. Its protocol entry point adapts one supplied `projectHost` into a
TypeScript language-service host.

```ts
// @volar/typescript@2.4.28/lib/protocol/createProject.d.ts
declare function createLanguageServiceHost<T>(
  ts: typeof import("typescript"),
  sys: ReturnType<typeof createSys> | ts.System,
  language: Language<T>,
  asScriptId: (fileName: string) => T,
  projectHost: TypeScriptProjectHost,
): LanguageServiceHost
```

The package's `quickstart` entry points integrate a Volar language plugin into
an already-existing TypeScript server project service. They do not construct or
export that project service for the standalone language-server protocol path.
Consequently, importing another `@volar/typescript` helper cannot make the
current reference request cross configured-project boundaries.

Status: installed-source observed; no standalone multi-project reference
provider found in the package surface used by the language server.

### TypeScript SDK loading

The Node language-server entry can load a TypeScript runtime after a client has
selected an explicit SDK directory. It does not select that directory.

```ts
// @volar/language-server@2.4.28/node.d.ts
declare function loadTsdkByPath(
  tsdk: string,
  locale: string | undefined,
): {
  typescript: typeof import("typescript")
  diagnosticMessages: import("typescript").MapLike<string> | undefined
}
```

```js
// @volar/language-server@2.4.28/node.js
function loadLib() {
  for (const name of ['./typescript.js', './tsserverlibrary.js']) {
    try {
      return require(require.resolve(name, { paths: [tsdk] }))
    }
    catch {}
  }
  throw new Error(
    `Can't find typescript.js or tsserverlibrary.js in ${JSON.stringify(tsdk)}`,
  )
}
```

Volar's TypeScript-version selection lives in its VS Code adapter. The adapter
reads editor configuration and persistent workspace state, validates paths
through the VS Code filesystem, and otherwise selects the TypeScript bundled
with VS Code or the nightly TypeScript extension.

```ts
// volarjs/volar.js@44d58aee/packages/vscode/lib/features/tsVersion.ts
export async function getTsdk(context: vscode.ExtensionContext) {
  if (isUseWorkspaceTsdk(context)) {
    const tsdkPath = getConfigTsdkPath()
    if (tsdkPath) {
      const resolvedTsdk = await resolveWorkspaceTsdk(tsdkPath)
      if (resolvedTsdk) {
        const version = await getTsVersion(resolvedTsdk)
        if (version !== undefined) {
          return { tsdk: resolvedTsdk, version, isWorkspacePath: true }
        }
      }
    }
  }
  const tsdk = await getVSCodeTsdk()
  return tsdk
    ? { tsdk: tsdk.path, version: tsdk.version, isWorkspacePath: false }
    : undefined
}
```

That policy depends on `vscode.ExtensionContext`, editor configuration,
workspace folders, installed extensions, and the VS Code application root. It
is not a headless package resolver. Reconstructing a different policy from a
workspace root would not reuse this affordance.

The generic language server therefore declares one compiler dependency and
passes the same imported module to both the Volar project and TypeScript
services:

```ts
// packages/code-intelligence-language-server/src/server.ts
return server.initialize(
  params,
  createTypeScriptProject(ts, undefined, () => ({
    languagePlugins: [],
  })),
  createTypeScriptServices(ts),
)
```

`loadTsdkByPath` remains available if a future public client configuration
selects an SDK directory. Until such a contract exists, the MCP does not infer
compiler selection from package resolution and sends no custom initialization
option.

Status: installed `@volar/language-server@2.4.28` source, upstream Volar VS Code
source at revision `44d58aee30d1d476c8ad3f6f5581b288d7185d1e`, and project
implementation inspected. The custom root package resolver and initialization
payload were removed.

### TypeScript integration modes are not interchangeable

The language-server project, tsserver-plugin proxy, and `tsc`/program proxy
consume different portions of a language plugin's TypeScript contract.

```js
// @volar/typescript@2.4.28/lib/node/decorateLanguageServiceHost.js
const serviceScript = sourceScript.generated.languagePlugin.typescript
  ?.getServiceScript(sourceScript.generated.root)

if (serviceScript) {
  if (serviceScript.preventLeadingOffset) {
    snapshot = serviceScript.code.snapshot
  }
  else {
    const leading = sourceContents
      .split('\n')
      .map(line => ' '.repeat(line.length))
      .join('\n')
    snapshot = ts.ScriptSnapshot.fromString(
      leading + serviceScript.code.snapshot.getText(
        0,
        serviceScript.code.snapshot.getLength(),
      ),
    )
  }
}

if (sourceScript.generated.languagePlugin.typescript?.getExtraServiceScripts) {
  console.warn('getExtraServiceScripts() is not available in TS plugin.')
}
```

```js
// @volar/typescript@2.4.28/lib/node/proxyCreateProgram.js
const { getServiceScript, getExtraServiceScripts } =
  sourceScript.generated.languagePlugin.typescript

// The program proxy applies the same optional leading-offset layout.
if (getExtraServiceScripts) {
  console.warn('getExtraServiceScripts() is not available in this use case.')
}
```

The protocol project created by `createTypeScriptProject` is the mode that
supports both primary and extra service scripts. The tsserver and program
proxies support a primary service script but explicitly reject extra scripts.
`preventLeadingOffset` controls the source-padding layout in those proxy modes;
the protocol project reads service-script snapshots directly and does not need
that switch.

Consequences:

- an importable generated module that needs its own filename belongs in the
  language-server project path;
- a tsserver plugin or `runTsc`/program proxy is a separate host surface, not a
  drop-in replacement for the MCP's Volar project;
- offset behavior must be read from the active integration mode rather than
  inferred from the shared `TypeScriptServiceScript` type.

Status: installed-source observed.

### TypeScript project setup hook

`createTypeScriptProject` exposes the active `Language` and `ProjectContext`
after their standard construction.

```ts
// @volar/language-server@2.4.28/lib/project/typescriptProject.d.ts
declare function createTypeScriptProject(
  ts: typeof import("typescript"),
  localizedMessages: ts.MapLike<string> | undefined,
  create: (context: ProjectExposeContext) => ProviderResult<{
    languagePlugins: LanguagePlugin<URI>[]
    setup?(options: {
      language: Language
      project: ProjectContext
    }): void
  }>,
): LanguageServerProject
```

```js
// @volar/language-server@2.4.28/lib/project/typescriptProjectLs.js
const { languagePlugins, setup } = await create({
  env: serviceEnv,
  configFileName: typeof tsconfig === 'string' ? tsconfig : undefined,
  projectHost,
  sys,
  uriConverter,
})

// createLanguageServiceHost(...) has already populated project.typescript.
setup?.({ language, project })
```

This is the sanctioned boundary for a language integration that must add
ambient files or narrowly adjust compiler-host behavior. It extends the one
Volar-owned project; it is not a reason to construct another TypeScript
language service beside it. The generic code-intelligence server currently
needs no setup hook.

Status: installed-source observed.

### Generic language-service extension points

`@volar/language-service` supplies reusable routing, virtual-code mapping, and
result transformation for declaration navigation, type hierarchy,
linked-editing ranges, document colors and presentations, document links, code
lenses, monikers, inline values, and workspace diagnostics. A service plugin
activates each pipeline by declaring the corresponding capability and provider
methods.

For example, the type-hierarchy pipeline spans all upstream layers:
`vscode-languageserver-protocol` defines prepare, supertype, and subtype
requests; `vscode-languageserver` registers their handlers;
`@volar/language-server` advertises and wires them for a plugin declaring
`typeHierarchyProvider`; and `@volar/language-service` maps and routes
`provideTypeHierarchyItems`, `provideTypeHierarchySupertypes`, and
`provideTypeHierarchySubtypes`. This composition pattern applies the same
authored-source mapping and provider routing used by Volar's other semantic
features.

Status: installed language-server and language-service source observed.

## Long-lived FeatureType freshness pipeline

FeatureType asks Volar to declare the files its project needs observed.

```ts
// packages/language-server/src/server.ts
connection.onInitialized(() => {
  server.initialized()
  server.fileWatcher.watchFiles(["**/*.{featuretype,ts,tsx,js,jsx,json}"])
})
```

Volar converts that declaration into standard LSP dynamic registration when
the connected client advertises support.

```js
// @volar/language-server@2.4.28/lib/features/fileWatcher.js
if (didChangeWatchedFiles?.dynamicRegistration) {
  await server.connection.client.register(
    DidChangeWatchedFilesNotification.type,
    { watchers: patterns.map((globPattern) => ({ globPattern })) },
  )
}
```

The registered notification already feeds Volar's TypeScript project host.

```js
// @volar/language-server@2.4.28/lib/project/typescriptProjectLs.js
serviceEnv.onDidChangeWatchedFiles?.(async ({ changes }) => {
  if (changes.some((change) => change.type !== FileChangeType.Changed)) {
    await updateCommandLine()
  }
  projectVersion++
})
```

Volar's TypeScript-system adapter uses the same notification to invalidate its
filesystem model. Its actual cache replacement branch is reproduced under
"Registered event producer inventory" below.

Resolved boundary: Volar owns pattern registration and every semantic response,
while the headless LSP client must supply the physical filesystem events. The
installed Volar stack has no Node event producer; the evidence below narrows the
adapter to one recursive Node subscription and standard LSP event translation.

### Project and module-resolution versions

Generated-script registration and TypeScript module-resolution caching observe
different upstream version signals.

```js
// @volar/typescript@2.4.28/lib/protocol/createProject.js
function sync() {
  const nextProjectVersion = projectHost.getProjectVersion?.()
  if (nextProjectVersion === lastProjectVersion) return

  lastProjectVersion = nextProjectVersion
  extraScriptRegistry.clear()
  // Re-read primary and extra service scripts from every project source.
}

let lastSysVersion = 'version' in sys ? sys.version : undefined
languageServiceHost.resolveModuleNameLiterals = moduleLiterals => {
  if ('version' in sys && lastSysVersion !== sys.version) {
    lastSysVersion = sys.version
    moduleResolutionCache.clear()
  }
  // Delegate each request to TypeScript's resolver and the Volar-aware host.
}
```

```js
// @volar/language-server@2.4.28/lib/project/typescriptProjectLs.js
serviceEnv.onDidChangeWatchedFiles?.(async ({ changes }) => {
  if (changes.some(change => change.type !== FileChangeType.Changed)) {
    await updateCommandLine()
  }
  projectVersion++
})

// @volar/typescript@2.4.28/lib/protocol/createSys.js
env.onDidChangeWatchedFiles?.(() => {
  version++
})
```

An open-document change advances the project version and refreshes virtual
service scripts. A standard watched-file notification advances both the project
version and `sys.version`, additionally clearing TypeScript's module-resolution
cache; create/delete events also reparse the configured file list. The client
should deliver the real standard event and let these independent consumers do
their work rather than selecting a cache to invalidate itself.

Status: installed-source observed; same-session dependency, create, delete,
configuration, and package-metadata changes observed.

### Runtime freshness boundary

An unchanged consumer does not observe an external dependency edit until the
dependency is synchronized or a watched-file event reaches Volar.

```json
{
  "before": "const observed: \"before\"",
  "indirectWithoutEvent": "const observed: \"before\"",
  "directDependencyRead": "const value: 123",
  "indirectAfterDirectRead": "const observed: 123",
  "indirectAfterEvent": "const observed: true"
}
```

The same sequence was reproduced through the session-attached MCP with its
public tools. `typecheck_file(consumer.ts)` passed before and immediately after
an external dependency edit. `get_type_at(value.ts)` then returned
`const value: 123`; the next `typecheck_file(consumer.ts)` returned TS2322.

```txt
Typecheck passed: consumer.ts
Typecheck passed: consumer.ts
const value: 123
TS2322 Type '123' is not assignable to type '"before"'.
```

Creation, deletion, and configuration changes have the same event boundary.

```json
{
  "initialMissing": [2307, 7044],
  "afterCreateWithoutEvent": [2307, 7044],
  "afterCreateEvent": [7044],
  "afterDeleteWithoutEvent": [7044],
  "afterDeleteEvent": [2307, 7044],
  "afterConfigWithoutEvent": [2307, 7044],
  "afterConfigEvent": [2307, 7006]
}
```

The experiments use `createDiagnosticsSession` against temporary NodeNext
projects and issue the same public document hover and diagnostic requests used
by the MCP. Codes `2307`, `7044`, and `7006` respectively demonstrate module
presence, the original non-strict parameter, and the strict config becoming
active.

### Filesystem-backed source scripts

Disk files do not need to become LSP open documents. Volar's TypeScript project
creates source scripts from its filesystem-backed system when a language
feature requests an unopened URI.

```js
// @volar/language-server@2.4.28/lib/project/typescriptProjectLs.js
const language = createLanguage(plugins, createUriMap(), (uri, includeFsFiles) => {
  const syncedDocument = server.documents.get(uri)
  let snapshot
  if (syncedDocument) {
    snapshot = syncedDocument.getSnapshot()
  }
  else if (includeFsFiles) {
    const fileName = uriConverter.asFileName(uri)
    const modifiedTime = sys.getModifiedTime?.(fileName)?.valueOf()
    if (!cache || cache[0] !== modifiedTime) {
      const text = sys.readFile(fileName)
      snapshot = text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined
      fsFileSnapshots.set(uri, [modifiedTime, snapshot])
    }
  }
  if (snapshot) language.scripts.set(uri, snapshot)
  else language.scripts.delete(uri)
})
```

The language-core registry invokes that synchronizer on ordinary source-script
access.

```js
// @volar/language-core@2.4.28/index.js
scripts: {
  get(id, includeFsFiles = true, shouldRegister = false) {
    sync(id, includeFsFiles, shouldRegister)
    return scriptRegistry.get(id)
  },
}
```

An installed Volar test client requested diagnostics and hover for an unopened
disk URI. No `didOpen` notification was sent.

```json
{
  "openDocuments": 0,
  "diagnostics": [2322],
  "hover": "const observed: \"before\""
}
```

FeatureType consequence: ordinary disk requests should send only the target
URI and let Volar own the source snapshot. `didOpen`, `didChange`, and
`didClose` are required only for caller-owned in-memory files. This removes the
need for the watched-files client to read or synchronize changed disk files.

The TypeScript service advertises document diagnostics but not workspace
diagnostics.

```js
// volar-service-typescript@0.0.65/lib/plugins/semantic.js
capabilities: {
  diagnosticProvider: {
    interFileDependencies: true,
    workspaceDiagnostics: false,
  },
}
```

Whole-project diagnostics therefore compose the supported Volar operation over
the project file set; they do not construct a separate TypeScript program.

```ts
const filePaths = [...diskFiles, ...virtualFiles]
return Promise.all(filePaths.map(async filePath => ({
  filePath,
  diagnostics: await getDocumentDiagnostics(filePath),
})))
```

A production session returned project-wide TS2322 and TS2307 results through
this path while every disk file remained unopened. The previous direct
`ts.createIncrementalProgram` diagnostic path duplicated Volar's semantic
authority and is unnecessary.

### Registered event producer inventory

The actual FeatureType server registration was captured from a temporary LSP
client advertising dynamic watched-file support.

```json
{
  "method": "workspace/didChangeWatchedFiles",
  "registerOptions": {
    "watchers": [
      { "globPattern": "**/*.{featuretype,ts,tsx,js,jsx,json}" }
    ]
  }
}
```

The installed Volar Node provider supplies filesystem reads, not observation.

```js
// @volar/language-server@2.4.28/lib/fileSystemProviders/node.js
exports.provider = {
  readFile(uri, encoding) {
    try {
      return fs.readFileSync(uri.fsPath, { encoding: encoding ?? "utf-8" })
    }
    catch {
      return undefined
    }
  },
}
```

The installed kit exposes typed event injection, not event production.

```ts
// @volar/kit@2.4.28 createTypeScriptChecker result
checker.fileCreated(fileName)
checker.fileUpdated(fileName)
checker.fileDeleted(fileName)
```

The installed protocol system similarly consumes the environment callback. The
following is the cache replacement branch with formatting normalized from the
installed JavaScript.

```js
// @volar/typescript@2.4.28/lib/protocol/createSys.js
const fileWatcher = env.onDidChangeWatchedFiles?.(({ changes }) => {
  version++
  for (const change of changes) {
    const changeUri = URI.parse(change.uri)
    const fileName = uriConverter.asFileName(changeUri)
    const dirName = path.dirname(fileName)
    const baseName = path.basename(fileName)
    const fileExists = change.type === 1 || change.type === 2
    const dir = getDir(dirName, fileExists)
    dir.files.set(normalizeFileId(baseName), fileExists
      ? {
          name: baseName,
          stat: {
            type: 1,
            ctime: Date.now(),
            mtime: Date.now(),
            size: -1,
          },
          requestedStat: false,
          requestedText: false,
        }
      : {
          name: baseName,
          stat: undefined,
          text: undefined,
          requestedStat: true,
          requestedText: true,
        })
  }
})
```

TypeScript's `System` is an available non-Volar event producer, but its two
watch APIs expose different contracts.

```ts
ts.sys.watchDirectory(root, changedPath => {
  // Reports the path, but not Created versus Changed versus Deleted.
}, true)

ts.sys.watchFile(file, (changedPath, eventKind) => {
  // eventKind distinguishes Created, Changed, and Deleted.
})
```

Runtime sequence for create, edit, and delete:

```json
{
  "watchDirectory": ["value.ts", "value.ts", "value.ts"],
  "watchFile": [0, 1, 2]
}
```

Using `watchFile` for dynamic glob registrations therefore requires initial
enumeration, one watcher per known file, recursive discovery of future files,
glob matching, and watcher lifecycle management. That is not supplied by the
inspected Volar packages.

The standard VS Code language client contains the complete registration
adapter, but delegates physical observation to the editor host.

```js
// vscode-languageclient@9.0.1/lib/common/fileSystemWatcher.js
fillClientCapabilities(capabilities) {
  ensure(ensure(capabilities, "workspace"), "didChangeWatchedFiles")
    .dynamicRegistration = true
}

register(data) {
  for (const watcher of data.registerOptions.watchers) {
    const globPattern = this._client.protocol2CodeConverter
      .asGlobPattern(watcher.globPattern)
    const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(
      globPattern,
    )
    this.hookListeners(fileSystemWatcher, true, true, true, disposables)
  }
}
```

This feature cannot execute headlessly because it imports the `vscode` module.
It remains the behavioral reference for the small host adapter, not a reusable
Node event source.

`@volar/vscode/node` does not provide a separate headless client. It re-exports
`vscode-languageclient/node`, whose module initialization imports the extension
host API.

```js
// @volar/vscode@2.4.28/node.js
module.exports = require("vscode-languageclient/node")

// vscode-languageclient@9.0.1/lib/node/main.js
const vscode = require("vscode")
```

Loading the installed entrypoint in an ordinary Node process therefore fails
before a language client can be constructed.

```txt
MODULE_NOT_FOUND: Cannot find module 'vscode'
Require stack:
- vscode-languageclient/lib/node/main.js
- vscode-languageclient/node.js
- @volar/vscode/node.js
```

The standard client also batches filesystem events for 250 milliseconds before
sending one notification.

```js
// vscode-languageclient@9.0.1/lib/common/client.js
this._fileEvents = []
this._fileEventDelayer = new Delayer(250)

notifyFileEvent(event) {
  const client = this
  async function didChangeWatchedFile(event) {
    client._fileEvents.push(event)
    return client._fileEventDelayer.trigger(async () => {
      await client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: client._fileEvents,
      })
      client._fileEvents = []
    })
  }
  const workSpaceMiddleware = this.clientOptions.middleware?.workspace
  ;(workSpaceMiddleware?.didChangeWatchedFile
    ? workSpaceMiddleware.didChangeWatchedFile(event, didChangeWatchedFile)
    : didChangeWatchedFile(event)).catch(error => {
      client.error("Notify file events failed.", error)
    })
}
```

The headless client also needs a read-after-write delivery boundary. An
external writer followed immediately by a semantic request reproduced stale
results in five of five runs when the client waited only one event-loop turn:

```json
{"before": [], "after": []}
```

Waiting 10 milliseconds for the operating-system event, flushing the pending
standard notification, and then issuing the semantic request produced the new
Volar result in ten of ten immediate runs:

```json
{"before": [], "after": [2322]}
```

This settle operation owns no file or project state. It only waits for the
host event already requested through Volar's dynamic registration and for the
resulting `workspace/didChangeWatchedFiles` notification to complete. Concurrent
whole-project document requests share the same bounded wait.

### Package metadata and open documents

Changing an installed package's `types` target from `a.d.ts` to `b.d.ts` and
sending only the ordinary watched-file event updates TypeScript module
resolution. A full Volar project reload does not change the already-correct
result.

```json
{
  "before": "(alias) const value: \"a\"",
  "afterOrdinaryEvent": "(alias) const value: \"b\"",
  "afterReload": "(alias) const value: \"b\""
}
```

An open document has a different LSP owner. Once a client sends `didOpen`,
Volar correctly treats that client snapshot as authoritative. A disk event
invalidates filesystem and project state, but cannot silently replace the open
snapshot; the client must send `didChange` for an externally changed disk-backed
document it owns.

```json
{
  "before": "(alias) const value: \"before\"",
  "afterWatchedEvent": "(alias) const value: \"before\"",
  "afterDocumentChange": "(alias) const value: 123"
}
```

FeatureType should not claim that ownership for ordinary disk files. Its open
document set should contain only explicit virtual files, whose content is
caller-owned and must not follow disk events. This narrows the headless client
boundary to one host operation:

```txt
physical add/change/unlink
  -> match the server-registered LSP glob and event kind
  -> workspace/didChangeWatchedFiles
  -> Volar cache, command-line, project-version, and module-resolution updates
```

### Event-source composition

The installed Volar packages contain event consumers and registration policy,
but no headless operating-system event producer. `vscode-languageclient` owns
the complete editor-host adapter through
`vscode.workspace.createFileSystemWatcher`; that API requires the VS Code host.

Volar's `@volar/kit` README demonstrates one possible producer for a
single-tsconfig checker. It uses Chokidar's normalized event names and forwards
them to the kit's explicit file-event methods:

```ts
// volarjs/volar.js@44d58aee/packages/kit/README.md
createWatcher(path.dirname(tsconfig), ['ts', 'js', 'foo'])
  .on('add', fileName => project.fileCreated(fileName))
  .on('unlink', fileName => project.fileDeleted(fileName))
  .on('change', fileName => project.fileUpdated(fileName))

function createWatcher(rootPath: string, extension: string[]) {
  return watch(`${rootPath}/**/*.{${extension.join(',')}}`, {
    ignored: path => path.includes('node_modules'),
    ignoreInitial: true,
  })
}
```

That example watches a bounded extension glob and excludes `node_modules`. It
does not own an LSP registration, multiple simultaneous workspace roots, or an
unbounded TypeScript monorepo. Applying its Chokidar root traversal to
`kek-monorepo` made the next workspace fail at process creation with
`spawn EBADF`; the watcher graph had consumed the process descriptors needed by
the second language-server child.

The MCP instead uses the recursive host subscription built into its declared
Node runtime. One subscription covers one workspace regardless of directory
count. The server-provided glob and `WatchKind` remain the only positive filter.
Node reports content events as `change`; its `rename` event is deliberately
coarser than the LSP event model, so the adapter uses final path existence only:

```ts
for await (const { eventType, filename } of watch(workspaceRoot, {
  recursive: true,
  signal: watcherController.signal,
})) {
  const types = eventType === "change"
    ? [FileChangeType.Changed]
    : await stat(filePath).then(
      () => [FileChangeType.Created, FileChangeType.Changed],
      () => [FileChangeType.Deleted],
    )
  await sendFileChanges(relativePath, types)
}
```

Pnpm creates package contents in its physical virtual store, then exposes a
logical package root such as `node_modules/ajv`. Volar and TypeScript cache the
logical manifest URI used during module resolution. The client forwards that
manifest when the package-root link changes:

```ts
// packages/code-intelligence-mcp/src/volar-workspace.ts
if (path.matchesGlob(relativePath, "**/node_modules/{*,@*/*}"))
  await sendFileChanges(path.join(relativePath, "package.json"), types)
```

One official MCP client and one persistent stdio process observed the same
source before and after `pnpm install --frozen-lockfile`:

```text
before: error ts(2307) 4:59-4:64 Cannot find module 'ajv' or its corresponding type declarations.
after:  no ajv diagnostic
```

No project reload or manual freshness notification occurred. The standard
`workspace/didChangeWatchedFiles` event invalidated Volar's filesystem cache,
advanced the TypeScript system version, and caused the next diagnostic request
to resolve the installed package.

Status: runtime-proven through the production stdio entrypoint.

An existing path after `rename` may be newly created or atomically replaced.
`Created` makes Volar refresh configured file membership; `Changed` disposes a
cached configuration project when relevant. Sending both preserves those two
native invalidation paths without retaining known files or reconstructing
project semantics. A missing path is unambiguously `Deleted`. The subscription
emits workspace-relative paths, which are matched before conversion to the
absolute document URI required by LSP.

Status: upstream `@volar/kit` source pattern, Chokidar 5 behavior, Node 22
recursive watcher contract, and direct multi-root MCP behavior observed. The
Chokidar dependency and traversal were removed after the production-shaped
failure; the standard LSP registration and Volar invalidation flow are
unchanged.

### Upstream-only composition feasibility

The complete upstream composition is executable only when a VS Code extension
host owns the workspace:

```txt
@volar/language-server server.fileWatcher.watchFiles(patterns)
  -> client/registerCapability
  -> @volar/vscode re-exported vscode-languageclient
  -> FileSystemWatcherFeature.register(...)
  -> vscode.workspace.createFileSystemWatcher(...)
  -> workspace/didChangeWatchedFiles
  -> Volar filesystem and TypeScript project invalidation
```

This is the only inspected composition in which every registration, event,
batching, and invalidation responsibility already has an upstream owner. The
MCP process is not a VS Code extension host, and the installed Volar packages
do not expose an alternative headless implementation of
`workspace.createFileSystemWatcher`.

Volar's reload notification is not an event-free equivalent. Volar exports the
notification descriptor and its VS Code adapter sends it, but the generic
language server does not register a handler. The generic server invokes the
project cache boundary only during shutdown:

```js
// @volar/language-server@2.4.28/protocol.js
ReloadProjectNotification.type =
  new protocol.NotificationType('volar/client/reloadProject')

// @volar/language-server@2.4.28/lib/server.js
shutdown() {
  state.project.reload()
}

// @volar/language-server@2.4.28/lib/project/typescriptProject.js
reload() {
  for (const project of [...configProjects.values(), ...inferredProjects.values()]) {
    project.then(project => project.dispose())
  }
  configProjects.clear()
  inferredProjects.clear()
}
```

It does not clear `server.fileSystem` read/stat/directory caches, `searchedDirs`,
or `rootTsConfigs`. Consequently, issuing reload before each semantic request
cannot replace watched-file delivery for newly created configurations, cached
dependency manifests, directory membership, or changed open documents.

The client must not retain `knownWatchedFiles`, recursively pre-enumerate the
workspace, classify events by comparing two custom sets, choose project-shape
filenames, or ask agents to call a notification tool. Actual dependency-file
events replace the current partial lockfile reload notification.

The same boundary is not sufficient to bound process memory.
`createTypeScriptProject` retains configured and inferred projects until
`reload()` or shutdown, but `typescriptProjectLs.js` also owns the module-level
`fsFileSnapshots` map outside those disposable projects. A production Codex
session crossed several monorepo projects and three language-server processes
terminated in `v8::internal::V8::FatalProcessOutOfMemory`; each pending request
surfaced `Pending response rejected since connection got disposed`. A direct
official-client run bound the native reload notification, sent it after one
minute of request idleness, and reproduced the same OOM on the next project.
The ineffective reload policy was removed rather than retained as a recovery
layer.

Process lifetime is therefore the narrow remaining client responsibility.
`packages/code-intelligence/src/volar-workspace.ts` removes an idle workspace
from its pool, then uses the standard LSP `shutdown` request and `exit`
notification. Volar's `server.shutdown()` performs project disposal; exiting the
child also releases the unexported module-level caches. A subsequent request
starts the same canonical language server with a clean process.

One official MCP client and stdio process called `read_file`, remained
connected across the idle boundary, and called `read_file` again:

```txt
first result keys       content
before idle             MCP process + Volar child
after 60 seconds idle   MCP process only
second result keys      content
after second request    same MCP process + new Volar child
```

Both results contained the requested source. Closing the official client then
removed the MCP process and its active child.

The activity boundary covers both semantic LSP requests and Volar-backed source
reads, so a read-only agent session cannot leave its language-server process
permanently resident.

### Implementation responsibility map

The source-freshness change should touch only the existing client boundary and
the public tool surface.

| Source | Retain | Replace or remove |
| --- | --- | --- |
| `packages/language-server/src/server.ts` | `server.fileWatcher.watchFiles(...)` | No custom watcher implementation |
| `packages/language-server/src/diagnostics.ts` initialization | Volar's protocol connection | Advertise `dynamicRegistration: true` and compose a dedicated watched-files client; keep registration and operating-system observation out of this module |
| Dedicated watched-files client module | Volar's returned registration id, glob, watch kind, and standard notification type | Own only the recursive Node host operation that `vscode.workspace.createFileSystemWatcher` owns in the upstream editor composition |
| `packages/language-server/src/diagnostics.ts` documents | Explicit virtual-document snapshots and their `didOpen`/`didChange`/`didClose` lifecycle | Stop opening or synchronizing ordinary disk files; request their URIs through Volar's filesystem-backed source graph |
| `packages/language-server/src/diagnostics.ts` watched files | `DidChangeWatchedFilesNotification` | Replace recursive pre-enumeration, whole-workspace known-file state, and client-side project-shape selection with one recursive Node subscription filtered by the registered LSP patterns |
| `packages/mcp/src/server.ts` internal mutation hooks | Immediate `manager.notifyFilesChanged(...)` after MCP-owned writes, preserving read-after-write ordering | Remove the agent-facing `notify_file_changed` tool after automatic observation is proven |
| `validate_files` | Its explicit synchronous path refresh, which gives the operation read-after-write semantics | Do not require a preceding agent tool call |

The automatic adapter needs focused executable checks for exactly these
contracts:

```txt
external edit       -> unchanged consumer sees the new type
external create     -> project diagnostics include the new module
external delete     -> project diagnostics report the missing module
external tsconfig   -> Volar disposes and recreates the configured project
dependency metadata -> consumer resolution observes the new package target
virtual document    -> filesystem events never replace caller-owned content
registration        -> watcher starts from Volar's returned glob
unregistration      -> watcher closes by registration id
disposal            -> no filesystem handle remains
public MCP surface  -> notify_file_changed is absent
```

The dependency test must change the actual package metadata and declaration
files while the watcher is active. A lockfile-only test would preserve the
invalid approximation disproved above.

## Affordance discovery map

Start from the behavior and trace the complete ownership chain. Export names
alone are insufficient because critical Volar behavior lives inside feature
registration closures and service-plugin implementations.

```txt
LSP request, notification, or registration
  -> @volar/language-server/lib/features
  -> @volar/language-server/lib/project
  -> @volar/language-service/lib/features
  -> volar-service-typescript/lib/plugins and lib/semanticFeatures
  -> @volar/typescript language-service host and protocol system
  -> @volar/kit headless composition
  -> @volar/vscode and vscode-languageclient host composition
```

Use the installed implementation, not package summaries:

```sh
rg -n "provide[A-Z]|onDidChange|watchFiles|registerCapability|createSys|fileUpdated" \
  node_modules/.pnpm/@volar+*/node_modules/@volar \
  node_modules/.pnpm/volar-service-typescript@*/node_modules/volar-service-typescript
```

Record the first producer, every transformer/consumer, and the final host
boundary before adding FeatureType code. This is necessary because the same
concept name denotes different ownership at different layers: Volar's
`fileWatcher` declares and consumes LSP events, TypeScript's `System` can observe
the OS but exposes a narrower callback, and VS Code's `FileSystemWatcher` is an
editor-host implementation.

Agents repeatedly missed these affordances because no single exported API
represents the full chain. The implementation is split across compiled package
files, many important functions live inside feature-registration closures, and
module-export listings are dominated by re-exported protocol types. Semantic
navigation also prioritizes workspace TypeScript rather than installed compiled
JavaScript. The durable correction is the behavior-first trace above plus the
repository rule requiring this ledger and a runnable boundary reproduction
before any custom implementation.

## Semantic edit production

| Finding | Installed source inspected | Objective behavior | FeatureType consequence | Status |
| --- | --- | --- | --- | --- |
| Symbol rename is owned by Volar. | `@volar/language-service@2.4.28/lib/features/provideRenameEdits.js` | Calls service-plugin rename providers, traverses linked code, transforms embedded ranges to source ranges, merges plugin edits, and deduplicates text edits. | `rename_symbol` sends the LSP rename request and passes the returned `WorkspaceEdit` unchanged to the host patch renderer. | Reuse |
| File-reference edits for a move are owned by Volar. | `@volar/language-service@2.4.28/lib/features/provideFileRenameEdits.js`; `@volar/language-server@2.4.28/lib/features/languageFeatures.js`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js` | The language server handles one `workspace/willRenameFiles` request, routes every old URI to its language service, calls TypeScript `getEditsForFileRename`, source-maps and deduplicates each result, and merges multiple requested moves. It deliberately leaves the physical move to the client. | Editing clients send the native request unchanged. The Code Intelligence MCP adds only the corresponding host move to the returned edit proposal; it implements no reference or rename logic. | Reuse plus required client move |
| Embedded edit mapping is owned by Volar. | `@volar/language-service@2.4.28/lib/utils/transform.js` — `transformWorkspaceEdit` | Maps text edits, annotations, create/rename/delete operations, and rename text from virtual documents to source documents. | FeatureType does not implement virtual-to-source edit mapping. | Reuse |
| Code-action discovery and resolution are separate Volar phases. | `@volar/language-service@2.4.28/lib/features/provideCodeActions.js`; `resolveCodeAction.js`; `@volar/language-server@2.4.28/lib/features/languageFeatures.js` | Listing preserves resolvable action data; resolution invokes the originating plugin and transforms the resolved edit and command. | `code_actions` lists native quick fixes and refactors and resolves only the displayed action selected by the caller. Stable source-wide actions use dedicated MCP entry points backed by the same request and resolve phases. | Reuse |
| Code-action contexts accept multiple diagnostics and server-side kind filters. | `volar-service-typescript@0.0.71/lib/semanticFeatures/codeAction.js` | A single request iterates every diagnostic in `CodeActionContext.diagnostics`. `context.only` selects quick fixes, refactors, organize-imports, fix-all, remove-unused, and add-missing-import paths before TypeScript work is performed. | `code_actions` supplies the native diagnostics intersecting the requested range and forwards quick-fix or refactor filters. Dedicated source-action tools request the exact provider-owned kinds; the MCP performs no action synthesis. | Reuse |
| TypeScript fixes, fix-all, organize imports, and refactors already become LSP edits. | `volar-service-typescript@0.0.71/lib/plugins/semantic.js`; `lib/semanticFeatures/codeAction.js`; `codeActionResolve.js`; `lib/utils/lspConverters.js` | Converts TypeScript `FileTextChanges` into `WorkspaceEdit` values, including create-file operations. Extract and rewrite refactors remain data-only when the client advertises resolution for both `edit` and `command`; resolution adds the edit and, when TypeScript returns a rename location, Volar's `editor.action.rename` command. | The MCP advertises both resolvable properties and never generates TypeScript fixes. Resolved edits enter the common patch renderer. A returned editor command remains an explicit follow-up rather than causing the valid edit to be discarded. | Reuse |
| Formatting is owned by Volar. | `@volar/language-service@2.4.28/lib/features/provideDocumentFormattingEdits.js` | Runs formatting providers, maps embedded edits, and uses `TextDocument.applyEdits` while traversing embedded formatting levels. | `format_document` sends `textDocument/formatting` and passes the returned edits through the standard `WorkspaceChange` builder to the host patch renderer. | Reuse |
| Completion, color, inlay-hint, drop, and auto-insert producers can carry edits. | `provideCompletionItems.js`; `provideColorPresentations.js`; `provideInlayHints.js`; `provideDocumentDropEdits.js`; `provideAutoInsertSnippet.js` in `@volar/language-service@2.4.28` | Produces feature-specific text edits, additional edits, resource creation metadata, or snippets. None is a general arbitrary source-edit executor. | These producers can use the shared applier if exposed later; they do not replace `edit_workspace`. | Not a patch-replacement contract |

## WorkspaceEdit construction and application

| Finding | Installed source inspected | Objective behavior | FeatureType consequence | Status |
| --- | --- | --- | --- | --- |
| `WorkspaceChange` is the standard edit builder. | `vscode-languageserver-types@3.17.5/lib/esm/main.js` — `WorkspaceChange`, `TextEditChangeImpl` | Builds versioned text edits, create/rename/delete operations, and change annotations. It groups text edits by document. | `format_document` uses it to place the native formatting edits in a standard `WorkspaceEdit`; file moves remain the client-side operation paired with `workspace/willRenameFiles`. | Reuse |
| `WorkspaceChange` does not migrate a legacy `changes` edit into `documentChanges`. | Same constructor, `initDocumentChanges`, and `getTextEditChange` implementation | When initialized with `changes`, adding a resource operation cannot initialize `documentChanges`; the builder throws because the edit is configured for the legacy lane. | FeatureType copies legacy text edits into a new versioned builder before appending a physical move. | Verified narrow adapter |
| Volar's `mergeWorkspaceEdits` is not an ordered transaction composer. | `@volar/language-service@2.4.28/lib/features/provideRenameEdits.js` — `mergeWorkspaceEdits`; `lib/utils/transform.js` — `pushEditToDocumentChanges` | Merges `changes` and `documentChanges` independently. Its document helper finds an existing text document anywhere in the array and appends edits to it, including across resource-operation positions. | FeatureType uses Volar's already-merged semantic results but does not use this helper to append the physical move. | Rejected for ordered client composition |
| `documentChanges` takes precedence over `changes`. | LSP `WorkspaceEdit` contract; `vscode-languageclient@9.0.1/lib/common/protocolConverter.js` — `asWorkspaceEdit` | The client conversion selects ordered `documentChanges`; the legacy `changes` lane is the alternative representation. | Execution, preview extraction, and summaries ignore `changes` whenever `documentChanges` is present. | Reuse and conformance tests |
| Text edit ordering and overlap rejection are already implemented. | `vscode-languageserver-textdocument@1.0.12` — `TextDocument.applyEdits`; equivalent implementation in `vscode-languageserver-types@3.17.5` | Stable-sorts edits by start position, applies them from the end, preserves same-position order, and throws on overlap. | The headless applier calls `TextDocument.applyEdits`; it has no custom position or overlap algorithm. | Reuse |
| The VS Code language client has a complete editor-host apply path. | `vscode-languageclient@9.0.1/lib/common/client.js` — `handleApplyWorkspaceEdit`; `protocolConverter.js` — `asWorkspaceEdit` | Serializes conversion, checks versions of open documents, converts annotations/resource operations, then delegates to `vscode.workspace.applyEdit`. | This is the behavioral reference. It cannot run headlessly because the final executor and converted objects come from the `vscode` extension-host module. | Host-bound |
| The language-server `workspace.applyEdit` method is a client request, not an executor. | `vscode-languageserver@9.0.1/lib/common/server.js` — `RemoteWorkspaceImpl.applyEdit`; LSP `ApplyWorkspaceEditRequest` | Wraps an edit in request parameters and sends `workspace/applyEdit` to the connected client. It performs no conversion or filesystem mutation in the server process. | FeatureType installs the client request handler and routes command-triggered edits back through the same headless applier. | Reuse at request boundary |
| VS Code file-operation features own editor lifecycle events. | `vscode-languageclient@9.0.1/lib/common/fileOperations.js` | Registers and forwards will/did create, rename, and delete editor events with server capability filtering. It does not expose a headless disk executor. | FeatureType calls Volar's will-rename request directly and owns the physical regular-file move. | Host-bound |
| Standard language-client feature modules are provider adapters, not an applier API. | `vscode-languageclient@9.0.1/lib/common/codeAction.js`; `completion.js`; `formatting.js`; `rename.js` | Registers VS Code providers, sends LSP requests, and converts results into VS Code objects. The editor invokes the resulting action, completion, formatting, or rename behavior. | None exposes protocol-only edit execution that can be imported by the headless MCP. | Host-bound |
| Save-time edits are owned by the editor save lifecycle. | `vscode-languageclient@9.0.1/lib/common/textSynchronization.js` — `WillSaveWaitUntilFeature` | Sends `textDocument/willSaveWaitUntil`, converts returned text edits, and gives them to VS Code through `TextDocumentWillSaveEvent.waitUntil`. | This is a text-edit producer path tied to an open editor document, not a workspace-edit executor. | Host-bound |
| Server `TextDocuments` synchronization updates an in-memory document model only. | `vscode-languageserver@9.0.1/lib/common/textDocuments.js`; `vscode-languageserver-textdocument@1.0.12` — `TextDocument.update` | Applies client-sent content changes to tracked document snapshots and emits open/change/save/close events. It does not write files or interpret `WorkspaceEdit`. | FeatureType keeps semantic document synchronization in the language client and does not treat it as disk application. | Not editing |

## Volar kit, filesystem, and test utilities

| Finding | Installed source inspected | Objective behavior | FeatureType consequence | Status |
| --- | --- | --- | --- | --- |
| `createFormatter` is a text formatter, not a workspace executor. | `@volar/kit@2.4.28/lib/createFormatter.js` | Gets formatting edits and returns `TextDocument.applyEdits` output for one input document. | It confirms the canonical text application API but does not apply multi-file resource edits. | Insufficient contract |
| Checker `fixErrors` is text-only and explicitly omits resource operations. | `@volar/kit@2.4.28/lib/createChecker.js` | Resolves and merges code actions, applies text edits, and calls a supplied `writeFile`; the source contains `TODO: CreateFile | RenameFile | DeleteFile`. | It cannot replace versions, annotations, permission checks, resource ordering, or transactional disk application. | Insufficient contract |
| Volar's language-server filesystem is read-only. | `@volar/language-server@2.4.28/lib/features/fileSystem.js`; Node filesystem implementation | Exposes cached `stat`, `readFile`, and `readDirectory` and invalidates caches from watched-file events. It exposes no write/create/rename/delete method. | Semantic reads and invalidation stay upstream; disk mutation remains a client boundary. | Insufficient contract |
| `@volar/test-utils` is a request harness, not a client applier. | `@volar/test-utils@2.4.28/index.js` and `index.d.ts` | Starts a language-server process, synchronizes documents, sends requests, and applies text edits in selected test helpers. It has no `workspace/applyEdit` handler or resource transaction. | It remains test evidence only. | Insufficient contract |
| `@volar/source-map` contains no editing API. | Complete `@volar/source-map@2.4.28` JavaScript/declaration scan | No `WorkspaceEdit`, text-edit, resource-operation, filesystem-write, code-action, or command application symbol exists in the package. | It cannot replace any edit lifecycle component. | Not editing |
| `@volar/typescript.createSys.writeFile` is raw compiler-system I/O. | `@volar/typescript@2.4.28/lib/protocol/createSys.js` | Delegates `writeFile` and `createDirectory` to the supplied TypeScript `System`; it has no LSP edit, version, annotation, authorization, rollback, or apply-result contract. | FeatureType does not use compiler-system writes as an MCP executor. | Insufficient contract |

## Project routing and freshness

| Finding | Installed source inspected | Objective behavior | FeatureType consequence | Status |
| --- | --- | --- | --- | --- |
| Volar already selects the nearest TypeScript configuration. | `@volar/language-server@2.4.28/lib/project/typescriptProject.js` — `findMatchTSConfig`; `lib/features/editorFeatures.js` — `GetMatchTsConfigRequest` | Searches ancestor configurations, resolves direct includes and project references, and returns the selected config through the official request. | FeatureType does not implement a second TS-project router inside an attached MCP root. | Reuse |
| Created/deleted files update configured project command lines. | `@volar/language-server@2.4.28/lib/project/typescriptProjectLs.js` | Watched create/delete events call `updateCommandLine`; all watched changes increment the project version. | FeatureType advertises watched-file support and sends committed paths. | Reuse |
| Config changes dispose the affected Volar project. | `@volar/language-server@2.4.28/lib/project/typescriptProject.js` — `setup` watcher | Created configs enter the root-config set; changed/deleted configs remove and dispose cached configured projects; language features are refreshed. | Ordinary tsconfig invalidation remains upstream. | Reuse |
| Volar exposes project-cache reload, not full filesystem reset. | `@volar/language-server@2.4.28/lib/types.d.ts` — `LanguageServerProject.reload`; `lib/project/typescriptProject.js`; `@volar/language-server/protocol.js` — `ReloadProjectNotification` | `reload()` disposes and clears configured and inferred projects. It does not clear the independent language-server filesystem caches. | Do not use project reload for dependency freshness. A lockfile experiment proved it does not refresh an unseen cached dependency manifest; the client instead forwards the exact logical manifest change through the standard watcher protocol. | Rejected for dependency freshness |
| Volar activates watched-file handling from client capabilities. | `@volar/language-server@2.4.28/lib/features/fileWatcher.js` | The `onDidChangeWatchedFiles` callback is installed when the capability exists; `dynamicRegistration: true` activates server-declared watcher patterns. | The code-intelligence client advertises dynamic registration and acknowledges the standard registration lifecycle. | Reuse |
| Volar declares watched paths through standard dynamic registration. | `@volar/language-server@2.4.28/lib/features/fileWatcher.js`; `packages/code-intelligence-language-server/src/server.ts` | `server.fileWatcher.watchFiles(patterns)` registers `workspace/didChangeWatchedFiles` with those glob patterns. | The language server declares `**/*`; the headless client emits physical changes through the registered protocol notification. | Reuse |
| Watched-file project invalidation is owned by Volar. | `@volar/language-server@2.4.28/lib/project/typescriptProject.js`; `lib/project/typescriptProjectLs.js`; `lib/features/fileSystem.js` | Config creation/change/deletion updates or disposes configured projects; create/delete events reparse the command line; every watched change advances the project version; filesystem caches invalidate from watched events. | FeatureType should forward registered file events and leave project graph, command-line, version, and read-cache invalidation to Volar. | Reuse |
| Volar's Node filesystem provider does not produce change events. | `@volar/language-server@2.4.28/node.js`; `lib/fileSystemProviders/node.js` | `createServer` installs synchronous `stat`, `readFile`, and `readDirectory` providers for `file:` URIs. The provider exposes no watcher and its caches are invalidated by `server.fileWatcher` notifications. | Running the Node server does not make workspace changes observable by itself. | Confirmed boundary |
| Volar's TypeScript system deliberately consumes the language-service watcher stream. | `@volar/typescript@2.4.28/lib/protocol/createSys.js` | `createSys` subscribes to `env.onDidChangeWatchedFiles`, updates its file tree, and increments its version. The returned TypeScript `System` does not expose the underlying `ts.sys.watchFile` or `ts.sys.watchDirectory`. | A Volar TypeScript project is refreshed through the standard LSP watcher stream, not a second TypeScript-native watcher. | Reuse |
| Filesystem snapshot mtime checks do not replace project invalidation. | `@volar/language-server@2.4.28/lib/project/typescriptProjectLs.js` | Filesystem snapshots are reread when a requested script's modified time changes. Separately, watched events advance `projectVersion`, reparse configured file lists after create/delete, and dispose changed configuration projects. | On-demand snapshot freshness is useful for a requested file but is not sufficient for changed dependencies, created/deleted files, or project configuration. | Confirmed boundary |
| Headless filesystem event production is a client-host boundary. | `@volar/language-server@2.4.28/lib/features/fileWatcher.js`; Node filesystem provider; `@volar/kit@2.4.28/lib/createChecker.js`; `@volar/typescript@2.4.28/lib/protocol/createSys.js`; `@volar/vscode@2.4.28`; `vscode-languageclient@9.0.1/lib/common/fileSystemWatcher.js` | Volar declares and consumes changes; all inspected headless APIs accept injected events. The complete upstream producer delegates to `vscode.workspace.createFileSystemWatcher`, which is unavailable headlessly. | Use a physical watcher only as the standard LSP client adapter. It must not own semantic file policy or project invalidation. | Required client adapter |

## Generic code-intelligence language server

`packages/code-intelligence-language-server` owns the Volar server and standard
TypeScript service composition.

```ts
// packages/code-intelligence-language-server/src/server.ts
export const registerLanguageServer = (connection: Connection): void => {
  const server = createServer(connection)
  let watchedFiles: { dispose(): void } | undefined

  connection.onInitialize(params =>
    server.initialize(
      params,
      createTypeScriptProject(ts, undefined, () => ({
        languagePlugins: [],
      })),
      createTypeScriptServices(ts),
    )
  )
  connection.onInitialized(async () => {
    server.initialized()
    watchedFiles = await server.fileWatcher.watchFiles(["**/*"])
  })
  connection.onShutdown(() => {
    watchedFiles?.dispose()
    server.shutdown()
  })
}
```

`createTypeScriptProject` appends Volar's standard TS/JS/JSON language resolver,
so the empty plugin list is the complete generic configuration.

```ts
// packages/code-intelligence-language-server/src/node.ts
const connection = createConnection()
registerLanguageServer(connection)
connection.listen()
```

Status: runtime-proven

The TypeScript system inside Volar changes the Node process working directory
while resolving paths.

```js
// @volar/typescript@2.4.28/lib/protocol/createSys.js
function resolvePath(fsPath) {
  if (sys) {
    const currentDirectory = getCurrentDirectory()
    if (currentCwd !== currentDirectory) {
      currentCwd = currentDirectory
      if (sys.directoryExists(currentDirectory)) {
        process.chdir(currentDirectory)
      }
    }
    return sys.resolvePath(fsPath).replace(/\\/g, "/")
  }
  return path.resolve(fsPath).replace(/\\/g, "/")
}
```

An in-process Volar server therefore changes the MCP process directory. A
deleted workspace made a later `process.cwd()` fail, and concurrent roots would
share this process-global state. The MCP keeps the LSP boundary process-isolated
and uses the complete IPC protocol connection exported by
`vscode-languageserver-protocol/node.js`.

```ts
// packages/code-intelligence-mcp/src/volar-workspace.ts
const languageServer = fork(
  new URL(
    import.meta.resolve("@featuretype/code-intelligence-language-server/node"),
  ),
  ["--node-ipc"],
  {
    cwd: workspaceRoot,
    execArgv: [],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  },
)

const connection = createProtocolConnection(
  new IPCMessageReader(languageServer),
  new IPCMessageWriter(languageServer),
)

connection.listen()

await connection.sendRequest(InitializeRequest.type, {
  processId: process.pid,
  rootUri: workspaceUri,
  workspaceFolders: [{ uri: workspaceUri, name: path.basename(workspaceRoot) }],
  capabilities: {
    workspace: {
      diagnostics: {},
      symbol: {},
    },
    textDocument: {
      callHierarchy: {},
      completion: { /* supported standard result forms */ },
      diagnostic: {},
      documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      definition: { linkSupport: true },
      implementation: { linkSupport: true },
      hover: { contentFormat: ["markdown", "plaintext"] },
      references: {},
      signatureHelp: { /* supported standard result forms */ },
      typeDefinition: { linkSupport: true },
    },
  },
})
```

These initialize fields describe the result forms the headless client can
consume. `vscode-languageserver-protocol` exports their types and wire methods,
not a capability builder. `vscode-languageclient` computes its capability
object privately from feature instances that import the `vscode` extension-host
runtime. Reusing that client to remove this declaration would introduce the
editor host into the headless process.

The MCP shuts down each workspace language-server session through the standard
LSP lifecycle and awaits the child process closing.

```ts
await connection.sendRequest(ShutdownRequest.type)
await connection.sendNotification(ExitNotification.type)
await languageServerExit
connection.dispose()
```

Initialization also gives the standard language-server watchdog the MCP process
identifier.

```ts
await connection.sendRequest(InitializeRequest.type, {
  processId: process.pid,
  // ...
})
```

```js
// vscode-languageserver@9.0.1/lib/node/main.js
initialize: params => {
  const processId = params.processId
  if (Is.number(processId) && exitTimer === undefined) {
    setInterval(() => {
      try {
        process.kill(processId, 0)
      }
      catch {
        process.exit(_shutdownReceived ? 0 : 1)
      }
    }, 3000)
  }
}
```

Normal completion uses LSP shutdown and exit. If the MCP process terminates
abnormally, the upstream watchdog terminates the language-server child.

One official MCP client kept the MCP process alive while alternating the
workspace argument from the repository root to the MCP package root and back.
Every call returned the same Volar-selected project and current diagnostic
report:

```json
{
  "results": [
    {
      "method": "volar/client/tsconfig",
      "result": {
        "uri": "file:///.../packages/code-intelligence-mcp/tsconfig.json"
      }
    },
    {
      "method": "textDocument/diagnostic",
      "result": { "kind": "full", "items": [] }
    }
  ]
}
```

The MCP owns one Volar workspace session per root. Repeated requests reuse the
same configured and inferred project maps, language services, script snapshots,
and TypeScript program state.

```js
// @volar/language-server@2.4.28/lib/project/typescriptProject.js
const configProjects = createUriMap()
const inferredProjects = createUriMap()

function getOrCreateConfiguredProject(server, tsconfig) {
  const tsconfigUri = uriConverter.asUri(tsconfig)
  let projectPromise = configProjects.get(tsconfigUri)
  if (!projectPromise) {
    projectPromise = createTypeScriptLS(/* active server environment */)
    configProjects.set(tsconfigUri, projectPromise)
  }
  return projectPromise
}
```

One official MCP client remained connected while the exported pool type changed
from `VolarWorkspaces` to `VolarWorkspacePool`. The next request on the same MCP
and Volar processes returned the new symbol and exact source range:

```txt
1 of 1 symbols (offset 0)
VolarWorkspacePool [class] /Users/tylermitchell/Projects/featuretype/packages/code-intelligence-mcp/src/volar-workspace.ts:243:0-243:74
```

The same session alternated between the FeatureType root, its MCP package root,
and `kek-monorepo`. Each root retained an isolated language-server child. Closing
the official MCP client closed the MCP process and every language-server child.

| Responsibility | Upstream affordance | Composition |
| --- | --- | --- |
| TypeScript runtime | `createTypeScriptProject` plus `volar-service-typescript` | One declared compiler version supplies the active project and human-facing providers. |
| Project routing | Configured/inferred project maps, ancestor config discovery, and project-reference traversal | Each root retains Volar's selected projects across agent requests. |
| Standard source languages | `@volar/typescript.resolveFileLanguageId` | TypeScript, JavaScript, module variants, JSX/TSX, and JSON use the standard language identities. |
| Workspace isolation | One language-server process and JSON-RPC connection per root | Process-global working-directory and project state remain root-local. |
| Freshness | Volar watched-file registration, filesystem-cache invalidation, TypeScript project-version changes, and config-project disposal | External create/change/delete events enter the standard LSP watcher stream. |
| Disk documents | Filesystem-backed `TextDocumentIdentifier` requests | Read-only observations work without opening editor documents. |
| Cancellation | MCP handler signal, `CancellationTokenSource`, and LSP `$/cancelRequest` | Each semantic request remains independently cancellable inside the persistent workspace. |
| Process lifecycle | LSP `shutdown` and `exit`, parent-process watchdog, and MCP stdin/signal shutdown | Session processes close together when the MCP client disconnects. |
| Agent output | MCP text content | Native human-facing fields and exact ranges are rendered once, without `structuredContent`. |

Status: installed-source observed; multi-root reuse, same-session source
freshness, sub-second repeated calls on `kek-monorepo`, and complete process
shutdown observed through the official MCP client over stdio.

## LSP watched-file composition

The headless client uses the protocol package's complete connection rather than
constructing JSON-RPC request names or message types itself:

```ts
// packages/code-intelligence-mcp/src/volar-workspace.ts
const connection = createProtocolConnection(
  new IPCMessageReader(languageServer),
  new IPCMessageWriter(languageServer),
)
```

`vscode-languageserver-protocol` defines the registration and notification
contracts shared by every layer:

```js
DidChangeWatchedFilesNotification.method = 'workspace/didChangeWatchedFiles'
DidChangeWatchedFilesNotification.type =
  new ProtocolNotificationType(DidChangeWatchedFilesNotification.method)

FileChangeType.Created = 1
FileChangeType.Changed = 2
FileChangeType.Deleted = 3
```

`vscode-languageserver` supplies the server-side notification subscription:

```js
onDidChangeWatchedFiles: (handler) =>
  connection.onNotification(DidChangeWatchedFilesNotification.type, handler)
```

Volar turns declared patterns into standard dynamic registration and fans the
resulting notification into project, filesystem, and TypeScript-system state.

```js
// @volar/language-server@2.4.28/lib/features/fileWatcher.js
await server.connection.client.register(
  DidChangeWatchedFilesNotification.type,
  { watchers: patterns.map(globPattern => ({ globPattern })) },
)

server.connection.onDidChangeWatchedFiles(event => {
  for (const callback of didChangeWatchedFilesCallbacks) callback(event)
})
```

The editor-host implementation in
`vscode-languageclient@9.0.1/lib/common/fileSystemWatcher.js` connects that
registration to the VS Code filesystem observer:

```js
const vscode = require('vscode')

const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(
  globPattern,
  !watchCreate,
  !watchChange,
  !watchDelete,
)
```

The headless MCP host connects the same registration to one recursive Node
subscription and emits the protocol's `Created`, `Changed`, and `Deleted`
values. Volar then owns filesystem-cache invalidation, configured-project
updates, project versioning, and language-feature refreshes.

```ts
// packages/code-intelligence-mcp/src/volar-workspace.ts
connection.onRequest(RegistrationRequest.type, ({ registrations: items }) => {
  for (const registration of items) {
    if (registration.method !== DidChangeWatchedFilesNotification.method) {
      continue
    }
    registrations.set(
      registration.id,
      registration.registerOptions as DidChangeWatchedFilesRegistrationOptions,
    )
  }
})

connection.onRequest(
  UnregistrationRequest.type,
  ({ unregisterations }) => {
    for (const registration of unregisterations) {
      registrations.delete(registration.id)
    }
  },
)

for await (const { eventType, filename } of watch(workspaceRoot, {
  recursive: true,
  signal: watcherController.signal,
})) {
  const types = eventType === "change"
    ? [FileChangeType.Changed]
    : await stat(filePath).then(
      () => [FileChangeType.Created, FileChangeType.Changed],
      () => [FileChangeType.Deleted],
    )
  await sendFileChanges(relativePath, types)
}
```

`matchesWatcher` respects the standard `WatchKind` bitmask and delegates
string-glob matching to
Node's `path.matchesGlob`. The current client advertises dynamic registration,
not `relativePatternSupport`, and the paired Volar server registers string
patterns, so the adapter does not implement the unadvertised `RelativePattern`
form. Registration ids remain the ownership boundary; the client retains no
semantic file policy.

Status: source-level MCP session observed. The same running workspace changed
its document outline immediately after an external patch, without a manual
notification or process restart.

### Language-server process lifecycle

`vscode-languageclient` is the complete editor-host LSP client. Its Node entry
owns server startup, transports, protocol connection, dynamic client features,
shutdown, and child termination, but it imports and validates the live `vscode`
extension host. Its watched-file feature likewise delegates to
`vscode.workspace.createFileSystemWatcher`. It cannot be instantiated by a
headless stdio MCP process.

Its lifecycle still establishes the protocol sequence and bounded process
ownership expected from a client:

```ts
// microsoft/vscode-languageserver-node@a7605732/client/src/common/client.ts
const tp = new Promise<undefined>(c => {
  RAL().timer.setTimeout(c, timeout)
})
const shutdown = (async connection => {
  await connection.shutdown()
  await connection.exit()
  return connection
})(connection)

return Promise.race([tp, shutdown])
```

```ts
// microsoft/vscode-languageserver-node@a7605732/client/src/node/main.ts
protected shutdown(mode: ShutdownMode, timeout: number = 2000) {
  return super.shutdown(mode, timeout).finally(() => {
    if (this._serverProcess) this.checkProcessDied(this._serverProcess)
  })
}
```

The MCP's client adapter follows the same LSP `shutdown` then `exit` sequence.
A two-second unreferenced timer terminates the owned child if that sequence does
not complete, so closing the MCP transport cannot leave a language-server
process or the MCP shutdown awaiting it indefinitely.

```ts
// packages/code-intelligence/src/volar-workspace.ts
const shutdownTimer = setTimeout(terminateLanguageServer, 2_000)
shutdownTimer.unref()

try {
  await connection.sendRequest(ShutdownRequest.type)
  await connection.sendNotification(ExitNotification.type)
  await languageServerExit
}
finally {
  clearTimeout(shutdownTimer)
  connection.dispose()
  terminateLanguageServer()
  await languageServerExit
}
```

`vscode-jsonrpc` already owns the pending-response registry and exposes its
state. The client adapter does not maintain a parallel request counter:

```ts
// vscode-jsonrpc@8.2.0/lib/common/connection.js
hasPendingResponse: () => responsePromises.size > 0

// packages/code-intelligence/src/volar-workspace.ts
if (!connection.hasPendingResponse() && isLanguageServerRunning()) {
  idleTimer = setTimeout(release, 60_000)
}
```

JSON-RPC exposes close, error, disposal, and pending-response observations, but
no idle duration or child-process release policy. The timer therefore owns only
the headless host's memory boundary; request concurrency remains entirely owned
by the protocol connection.

Status: upstream source at revision
`a7605732a9d0e5f2598ed2e4051119209589bb22`, installed protocol source, and
project implementation inspected. The reusable protocol and IPC primitives are
used directly; only the VS Code-host operations remain in the headless adapter.

Refresh support is an editor-cache capability, not a prerequisite for making a
new language request. The upstream handlers invalidate registered VS Code
providers by firing editor events:

```ts
// microsoft/vscode-languageserver-node@a7605732/client/src/common/inlayHint.ts
this._client.onRequest(InlayHintRefreshRequest.type, async () => {
  for (const provider of this.getAllProviders()) {
    provider.onDidChangeInlayHints.fire()
  }
})
```

The MCP does not cache diagnostic, inlay-hint, or semantic-token pages and has
no provider UI to invalidate. It therefore does not advertise those workspace
refresh capabilities or install handlers that acknowledge a refresh without
performing it. Every tool invocation requests current data from the persistent
language server directly. Workspace configuration remains advertised and its
standard `ConfigurationRequest` is served because the TypeScript service uses
those values when constructing results.

Status: upstream source and project client capabilities inspected; false
refresh support and its no-op request handlers were removed.

## Implementation source inspection

| Finding | Installed source inspected | Objective behavior | FeatureType consequence | Status |
| --- | --- | --- | --- | --- |
| Document-symbol hierarchy has no upstream depth parameter. | LSP `DocumentSymbolParams`; `@volar/language-service@2.4.28/lib/features/provideDocumentSymbols.js`; direct official-client MCP use | Volar returns the complete mapped hierarchy. On the MCP registration module, the native hierarchy was 3,587 lines and more than 31,000 output tokens; the useful top-level outline was 11 items and under 1,000 tokens. | `document_symbols` retains every native top-level item and range by default, accepts `depth` for explicit nested expansion, and uses `raw` to request the full hierarchy in the same text representation. | Required presentation boundary |
| Workspace-symbol matching can produce a broad native result even for an exact-looking query. | `volar-service-typescript@0.0.71/lib/plugins/semantic.js` — `provideWorkspaceSymbols`; TypeScript `getNavigateToItems`; direct official-client MCP use | Querying `clientCapabilities` returned 61 ordered native symbols. A 50-item page exceeded 5,900 output tokens; the desired project declaration remained the second item in the first 10-item page, which was about 1,200 tokens. The protocol request has no result limit, so MCP paging bounds output only after the language service completes its workspace search. | Preserve TypeScript's ranking and ambiguity, default to 10 items, and expose `offset`, `limit`, and `raw` rather than adding custom name scoring. Tool discovery warns that the request may be expensive in a large monorepo, recommends `document_symbols` when the file is known, and distinguishes output limits from search work. | Required presentation boundary |
| A generic recursive MCP output schema adds discovery cost without information. | `@modelcontextprotocol/server@2.0.0-beta.4/dist/mcp-Ctiu4nBa.mjs` — `registerTool`, tool listing, and `validateToolOutput`; direct official-client `tools/list` | The server serializes an output schema into every tool definition and validates `structuredContent` only when one is registered. The unconstrained recursive JSON schema repeated for every tool reduced no result ambiguity and expanded discovery from roughly 3,800 to 7,000 tokens. | The MCP keeps precise ArkType-derived input schemas, omits the non-informative output schema, and returns only text content. | Reuse server optionality |
| Standard Schema is the native v2 tool-schema boundary. | `@modelcontextprotocol/server@2.0.0-beta.4/dist/createMcpHandler-D93NefGZ.d.mts` — `registerTool`; `dist/src-D5Nfqtoz.mjs` — `standardSchemaToJsonSchema`, `validateStandardSchema`; direct official v2-client and v1-client stdio use | `registerTool` accepts a `StandardSchemaWithJSON`, converts it for `tools/list`, and validates calls through the schema. ArkType implements this contract directly. | Register ArkType modules directly. Do not convert ArkType to JSON Schema and then reconstruct a Zod schema; the MCP has no direct Zod dependency. | Reuse; official clients verified |
| The v2 package does not enable the 2026 protocol on a hand-wired stdio transport. | `@modelcontextprotocol/server@2.0.0-beta.4/dist/stdio.mjs` and `stdio.d.mts` — `serveStdio`; upstream `support-2026-07-28` guide; direct official v2-client negotiation | `server.connect(new StdioServerTransport())` remains on the 2025-era initialization path. `serveStdio(factory)` owns era discovery, pins one factory instance for the connection, serves legacy clients by default, and closes the pinned instance and transport together. The factory may also be constructed once for a discarded discovery probe. | The executable uses `serveStdio` with a cheap server factory and keeps long-lived workspace sessions outside that factory. An official v2 client negotiated `modern` / `2026-07-28`, while an official v1 client continued to list and call all tools. | Reuse; modern and legacy stdio paths verified |
| The 2026 protocol carries native cache policy for discovery results. | `@modelcontextprotocol/server@2.0.0-beta.4` `ServerOptions.cacheHints`; upstream server guide — cache hints; direct modern `tools/list` use | Modern responses default to immediately stale, private caching. `tools/list` may declare a positive TTL and public scope when its value is identical for every caller; 2025-era responses are unchanged. | The static tool catalog declares `listChanged: false` and a one-minute public cache hint. Tool-call results remain uncached because they depend on live workspace state. | Reuse current protocol contract |
| MCP implementation metadata carries the portable server identity. | `@modelcontextprotocol/server@2.0.0-beta.4` — `Implementation`, `Icon`; Codex `0.145.0-alpha.18` `McpServerInfo` schema and `mcpServerStatus/list`; Codex Desktop `26.715.31925` `local-conversation-thread` and server-logo bundles | `Implementation` accepts machine `name`, UI `title`, `version`, `description`, `websiteUrl`, and themed icons. Codex preserves every field, selects the largest icon for the active theme, and uses the title and icon when presenting the integration. | The server uses `code-intelligence-mcp` as its stable protocol name, `Code Intelligence MCP` as its title, derives version and website from package metadata, and embeds a packaged 64px PNG so local stdio use has no network dependency. | Reuse; MCP and Codex ingestion verified; renderer behavior source-proven |
| Tool titles, descriptions, and behavioral annotations are first-class discovery metadata. | `@modelcontextprotocol/server@2.0.0-beta.4` — `Tool`, `ToolAnnotations`, `registerTool`; MCP display-name precedence; Codex `d26a9bf` `core/src/mcp_tool_call.rs`, `core/src/tools/handlers/mcp.rs`; Codex `0.145.0-alpha.18` `mcpServerStatus/list`; session-attached tool discovery and parallel calls; Codex Desktop `26.715.31925` ordinary MCP activity-label renderer | A top-level `Tool.title` takes precedence over the legacy-compatible `annotations.title`, then the machine name. Codex projects the tool description and input-schema field descriptions into agent discovery and retains titles and annotations. `readOnlyHint` suppresses automatic write approval and enables parallel calls even without server-wide opt-in; `destructiveHint` and `openWorldHint` participate in approval policy. Ordinary Codex activity rows are a separate surface: their item carries the machine tool name but not its discovered title, and the renderer humanizes that name. | Every tool has one stable top-level title, a concise workflow description, precise ArkType field descriptions, and truthful read-only, non-destructive, idempotent, closed-world annotations. Do not duplicate the title into annotations or distort stable machine names to tune one client's activity copy. Result bodies remain plain text and are not duplicated into metadata. | Reuse; MCP discovery, Codex discovery, approval, parallelism, and activity rendering directly verified or source-proven |
| Synchronous tools need no execution metadata in the v2 protocol. | `@modelcontextprotocol/server@2.0.0-beta.4/dist/createMcpHandler-D93NefGZ.d.mts` — `registerTool`; `dist/mcp-Ctiu4nBa.mjs` — `_createRegisteredTool`; `dist/src-D5Nfqtoz.mjs` — `enforceDeletedFields`; direct official v2-client and v1-client `tools/list` | The v2 registration config has no `execution` field and ordinary tools are created without one. The 2026-07-28 wire codec explicitly deletes legacy `execution.taskSupport`; neither current nor compatibility clients receive it. | Keep ordinary tool registration and do not recreate the removed field or introduce MCP Tasks for fast request-response language-service operations. | Reuse current protocol contract |
| Tool `_meta` is an opaque extension boundary, not a portable presentation API. | MCP `Tool`; `@modelcontextprotocol/server@2.0.0-beta.4` — `registerTool` and list handler; Codex Desktop `26.715.31925` MCP-app renderer paths | The server passes arbitrary tool `_meta` through discovery without assigning semantics. Codex interprets specific private keys for MCP apps and connected-app presentation, while ordinary MCP tool rows do not derive their icon or label from an undocumented `_meta` field. | Leave `_meta` absent. Code Intelligence is a normal tool server, so app/widget metadata would be client-specific coupling without a corresponding product surface. | Standard extension point intentionally unused |
| The generic per-tool activity icon is a Codex renderer choice, not missing server metadata. | MCP `Tool.icons`; `@modelcontextprotocol/server@2.0.0-beta.4` `McpServer.registerTool`; Codex Desktop `26.715.31925` `mcpToolCall` activity renderer and MCP source resolver | The v2 server accepts per-tool icons natively. For ordinary calls, Codex resolves connected apps and special browser/computer-use sources; an unrecognized MCP server is represented with no logo and the row renders its hard-coded generic MCP glyph. The activity item carries the server name, tool name, arguments, and result but not `Tool.icons`, so that field is not consulted. Integration presentation separately reads `Implementation.icons`. | Use the standard server icon. Do not repeat an icon in every tool definition or add undocumented `_meta` keys to target a renderer that reads neither field. Distinct tool icons remain unimplemented until they have justified semantics and actual assets. | Native affordance available; current client does not render it |
| Codex consumes the standard tool surface without a private presentation contract. | Rebuilt session-attached Code Intelligence MCP after Codex restart; `project_config`, `document_symbols`, `hover`, and `read_file` on `kek-monorepo`; session tool discovery | Codex discovered all 17 registered tools, projected tool and ArkType field descriptions into the agent catalog, ran independent read-only requests concurrently without approval, and received only text content with no `structuredContent`. Activity rows continued through the ordinary MCP renderer described above. | Keep the portable `Implementation`, `Tool`, schema, and annotation fields as the complete Codex integration boundary. No client-specific metadata is needed. | Direct session-attached use verified |
| Server instructions become repeated model-facing namespace descriptions in Codex. | `@modelcontextprotocol/server@2.0.0-beta.4` — `ServerOptions.instructions`; Codex `d26a9bf` `codex-mcp/src/rmcp_client.rs` and `core/src/tools/handlers/mcp.rs`; session tool discovery | Codex assigns non-app server instructions to every tool's namespace description, so a multi-sentence block is repeated across the model-facing catalog rather than paid once at initialization. | Omit server instructions. Put short coordinate and path contracts directly on the relevant ArkType fields; keep workspace-symbol cost and diagnostic routing in their owning tool descriptions. | Reuse server optionality; Codex projection source-proven |
| Catalog presentation metadata is shared across MCP surface kinds. | `@modelcontextprotocol/server@2.0.0-beta.4/dist/src-D5Nfqtoz.mjs` — `BaseMetadataSchema`, `ToolSchema`, `PromptSchema`, `ResourceSchema`, `ResourceTemplateSchema`; `McpServer.registerPrompt`, `registerResource` | Implementations, tools, prompts, resources, and templates share native `name`, optional `title`, and icons. Prompts additionally advertise a description, arguments, and `_meta`; resources and templates advertise description, media type, annotations, and `_meta`, with size on concrete resources. Tools add descriptions, input/output schemas, behavioral annotations, protocol-era execution vocabulary, and `_meta`. | Keep identity fields on their owning catalog item. Do not manufacture prompts or resources merely to obtain titles or icons already available on tools and implementation metadata. | Reuse; installed wire schemas and registration APIs inspected |
| Prompts, resources, and resource templates are distinct MCP surfaces rather than alternate tool metadata. | MCP `Prompt`, `Resource`, and `ResourceTemplate` types; `@modelcontextprotocol/server@2.0.0-beta.4` `registerPrompt`, `registerResource`, `ResourceTemplate`; Codex `0.145.0-alpha.18` generated status schema and resource handlers | Prompts produce reusable user/assistant messages and accept Standard Schema arguments. Resources expose stable URI-addressed content. A `ResourceTemplate` adds a URI pattern plus optional listing and per-variable completion, while resource registration can attach a 2026 read-cache hint. Codex lists, completes, and reads these surfaces independently from tools. | Code intelligence results depend on a workspace, file, position, and live semantic request, so registering prompts or resources would create a second, less direct interface or duplicate tool output. Advertise only tools until the server owns genuinely stable URI-addressed content or a canonical reusable prompt. | Native surfaces inventoried; intentionally unused |
| Workspace symbols provide implementation ranges. | `@volar/language-service@2.4.28/lib/features/provideWorkspaceSymbols.js`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js` — `provideWorkspaceSymbols`; `lib/utils/lspConverters.js` — `convertNavigateToItem` | TypeScript `getNavigateToItems` results become `WorkspaceSymbol` values and Volar maps their locations from embedded code to source code. | The MCP returns the mapped native symbols and only applies paging unless `raw` is requested. | Reuse |
| Document symbols provide compiler-derived identifier and declaration ranges. | `volar-service-typescript@0.0.71/lib/plugins/syntactic.js` — `provideDocumentSymbols`; `lib/utils/lspConverters.js` — `convertNavTree` | TypeScript's navigation tree becomes `DocumentSymbol` values whose declaration `range` includes the navigation span and whose `selectionRange` comes directly from `nameSpan`. | The MCP returns the hierarchy directly; it performs no source-text symbol search. | Reuse |
| Document symbols do not select an enclosing declaration for an arbitrary source range. | LSP `DocumentSymbolParams`; `@volar/language-service@2.4.28/lib/features/provideDocumentSymbols.js`; `volar-service-typescript@0.0.71/lib/plugins/syntactic.js` — `provideDocumentSymbols`; direct built-stdio MCP use on retrieved TypeScript ranges | The request accepts a document, not a source range, and returns the complete mapped declaration hierarchy. Its ranges are sufficient for a consumer to determine which declaration contains an externally retrieved range, but Volar exposes no separate range-to-symbol request. | Intelligence tools select the native document symbol with the greatest overlap, using hierarchy depth only to break ties. When a retrieval query contains an exact code-shaped identifier, the matching overlapping document symbol becomes the anchor without changing Semble result order. Investigation preserves that selected native symbol instead of widening back to its top-level ancestor. Bounded snippets are selected from Semble's complete native chunk around that exact source range, so improving the anchor does not expand the response. No source parsing, secondary ranking, or symbol inference is added. | Required composition boundary; exact nested-symbol search, bounded source, and investigation verified through built stdio |
| Ranked retrieval candidates can be grouped by exact declaration ancestry without changing their retrieval rank. | Native Semble result order and source ranges; hierarchical LSP document-symbol paths; direct built-stdio conceptual and identifier investigations | Semble provides approximate ranked chunks and Volar provides exact declaration ancestry, but neither claims that the first semantic candidate is the answer. | `investigate_code` displays only the requested native result page while internally retrieving up to three times that count. Exact code-shaped identifiers inspect only their matching symbol. Conceptual questions inspect the deepest retrieved symbol or symbols sharing candidate one's top-level Volar declaration, preserving their original ranks in the heading. Structurally unrelated candidates are not expanded; related-code similarity is opt-in. | Required composition boundary; broad filesystem-freshness question selected `sendFileChanges` at native rank 7 without displaying extra candidates |
| Folding ranges already traverse the complete TypeScript and virtual-code pipeline. | `vscode-languageserver-protocol@3.17.5` — `FoldingRangeRequest`; `@volar/language-server@2.4.28/lib/features/languageFeatures.js`; `@volar/language-service@2.4.28/lib/features/provideFoldingRanges.js` and `lib/utils/transform.js` — `transformFoldingRanges`; `volar-service-typescript@0.0.71/lib/plugins/syntactic.js` — `provideFoldingRanges`; `lib/utils/lspConverters.js` — `convertOutliningSpan` and `adjustFoldingEnd` | The TypeScript service calls `getOutliningSpans`; Volar converts the spans to LSP ranges, maps embedded ranges back to source, preserves optional fields such as `collapsedText`, and preserves `imports`, `comment`, and `region` kinds. The TypeScript converter already moves fold ends before closing `}`, `]`, `)`, and backticks. | A folded reader should send the native request, use provider-supplied collapsed text when present, and must not parse TypeScript, derive fold boundaries, reproduce closing-delimiter rules, or perform source-map work. | Reuse |
| Volar service plugins are the multi-language extension boundary. | `volar-service-json@0.0.71`; `volar-service-markdown@0.0.71`; `vscode-json-languageservice`; `vscode-markdown-languageservice@0.5.0-alpha.6`; direct official-client MCP use | The JSON plugin selects `json` and `jsonc` documents and provides native completion, definition, diagnostics, hover, links, symbols, colors, folding, selection, and formatting. The Markdown plugin selects Markdown documents and provides native code actions, completion, definition, diagnostics, highlights, links, symbols, folding, hover, references, file references, rename, file-rename edits, selection, and workspace symbols. Both expose standard `LanguageServicePlugin` values for the same service array already used by TypeScript. The Markdown plugin's `~0.5.0-alpha.6` dependency currently resolves to an incompatible ESM `0.5.0` release whose own `vscode-uri` default import terminates Node; the exact CommonJS provider version consumed by the plugin loads correctly. | Register the canonical plugins once in the shared language server and pin the Markdown provider version the published plugin targets. Existing LSP-backed tools then acquire language-appropriate observations without file-extension branches, custom parsers, or MCP-specific providers; source reading through the shared Volar server filesystem remains language-independent. | Reuse; native Markdown and JSON reads, folds, symbols, diagnostics, correction, rename, JSONC, and deletion verified in one stdio process |
| Language plugins resolve unopened-file language IDs. | `@volar/language-core@2.4.28/lib/types.d.ts` — `LanguagePlugin.getLanguageId`; `@volar/language-server@2.4.28/lib/project/typescriptProjectLs.js`; `@volar/typescript@2.4.28/lib/common.js`; direct official-client MCP use | Volar documents `getLanguageId` specifically for files whose language ID was not synchronized because they are not open in an IDE. The TypeScript project consults synchronized documents, configured language plugins, then `@volar/typescript.resolveFileLanguageId`; the last resolver recognizes JavaScript, TypeScript, JSX, TSX, and JSON, but not Markdown or JSONC. A real Markdown document therefore returned no symbols even with the Markdown service registered, while the same process returned the native JSON property hierarchy. | Supply one standard language plugin for the service-backed extensions missing from the TypeScript resolver. Keep the TypeScript project and service plugins unchanged; do not emulate editor open/close state or combine independent project providers. | Reuse; Markdown and JSONC routing directly verified without document-open notifications |
| LSP and the editor adapters do not render a headless folded document. | `vscode-languageserver-protocol@3.17.5/lib/common/protocol.foldingRange`; `@volar/monaco@2.4.28/lib/provider.ts` and `lib/languages.ts`; `monaco-languageserver-types@0.4.1` — `toFoldingRange`; `monaco-editor-core@0.55.1/esm/vs/editor/contrib/folding/browser/hiddenRangeModel.js` and `folding.js`; direct official-client MCP use | The Volar adapter forwards `getFoldingRanges` to Monaco's provider and converts zero-based LSP lines to one-based editor lines. Monaco's collapsed view hides `start + 1` through `end`, ignores ranges contained by an already hidden range, and calls `editor.setHiddenAreas`; the rest of its implementation manages editor decorations, cursor movement, persisted state, and commands. It exposes no headless text renderer. | `read_file` obtains source from the shared Volar server filesystem, sends the native folding request, then applies Monaco's hidden-line boundary while retaining conventional one-based line numbers. Its presentation policy keeps views of 20 lines or fewer, standard comment/imports/region ranges, and type declarations visible; requires a fold to hide at least six lines; and leaves any range spanning more than half the current view open so useful nested folds remain available. An empty folding result naturally preserves complete line-numbered text, while provider-specific structural kinds such as JSON's `object` and `array` remain foldable. Inclusive line bounds enable whole-file outline, structurally folded range expansion, and exact bounded source through the same representation. It does not derive fold ranges, reread the physical file, or instantiate Monaco. | Required presentation boundary; verified over local stdio with native Markdown, JSON, and TypeScript folding providers |
| Call hierarchy provides mapped direct callers and callees. | `@volar/language-service@2.4.28/lib/features/provideCallHierarchyItems.js`; direct official-client MCP use | Produces source-mapped `range` and `selectionRange` values, retains plugin routing data, and maps and deduplicates incoming and outgoing calls. On `planTensorStorage`, incoming calls grouped three named callers with exact sites, while outgoing calls grouped eight direct callees with their definition bodies and sites. | The MCP exposes the native directions as intent-named `callers` and `callees` tools beside other navigation tools. Each composes preparation with its corresponding native request and preserves every upstream item and call result. | Reuse; intent-oriented MCP surface |
| A complete symbol working view is a client composition, not a separate semantic provider. | LSP hover, document-symbol, definition, type-definition, implementation, references, and call-hierarchy requests; `@volar/language-server@2.4.28` language-feature routing; `volar-service-typescript@0.0.71` semantic and syntactic plugins; direct official-client source-level MCP use on callable, interface, ambiguous-name, position-selected, source-expanded, external-library, bounded, and multi-workspace cases | The installed stack exposes each editor observation independently and has no `inspect` request. Document symbols select an exact file-local name and provide kind and declaration ranges; definition links provide the complete target body; call hierarchy supplies named callers, callees, and their bodies; references contain the remaining project-scoped locations. Volar deduplicates mapped results within a provider, but an exact duplicate call-site range can remain and the same declaration or call site legitimately appears across different providers. External definitions retain their physical `file:` URI; standard LSP has no request that returns the corresponding server-owned document text to the client. | `inspect_symbol` sends those native requests and adds only client concerns: exact-name ambiguity, cross-provider duplicate removal, file grouping, bounded sections, small source-line context for otherwise opaque references, and optional complete source. Workspace and external source both use the shared Volar filesystem request with the exact upstream `file:` URI. Callable type definitions and complete source remain off by default. The shared operation serves both MCP and native Codex tools; it performs no AST analysis, call discovery, type inference, source mapping, or project aggregation. | Required agent-presentation composition; external dependency source directly verified through MCP |
| Completion resolution is the upstream human-detail phase. | `@volar/language-server@2.4.28/lib/features/languageFeatures.js`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js` — `resolveCompletionItem`; direct official-client MCP use | The initial list is intentionally light. Resolution calls TypeScript `getCompletionEntryDetails` and adds signature detail, Markdown documentation, label details, and edits. On `McpServer` members, unresolved items lacked both detail and documentation; resolved items contained both. | Completion remains unresolved by default. `resolve: true` invokes the native resolve request only for the selected page. | Reuse; explicit expensive phase |
| Generic Volar type hierarchy is inactive for TypeScript. | `vscode-languageserver-protocol@3.17.5` type-hierarchy requests; `vscode-languageserver@9.0.1` feature; `@volar/language-server@2.4.28/lib/features/languageFeatures.js`; `@volar/language-service@2.4.28/lib/features/provideCallHierarchyItems.js`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js` | Every generic routing and mapping layer exists, but the TypeScript plugin exposes call hierarchy and no type-hierarchy capability or provider methods. | The MCP does not advertise a nonfunctional type-hierarchy tool and does not reconstruct inheritance outside Volar. | Upstream service gap |
| File-reference discovery supplies module-level consumers independently of symbol references. | `@volar/language-server@2.4.28/protocol.js` — `FindFileReferenceRequest`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js` — `provideFileReferences`; direct official-client MCP use | TypeScript `getFileReferences` returned the two importing module-specifier ranges for `plan-tensor-storage.ts`; symbol references returned eight declaration and usage ranges instead. The upstream request has no paging input, so the MCP pages only the completed native locations and preserves `raw` access. | `file_references` exposes the distinct native observation and reuses the existing reference-page boundary without deriving a dependency graph. | Reuse; required presentation boundary |
| Rename preparation is an internal phase of an agent-level rename operation, not a standalone observation. | `@volar/language-server@2.4.28/lib/features/languageFeatures.js`; `@volar/language-service@2.4.28/lib/features/provideRenameRange.js`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js` — `provideRenameRange`; direct official-client MCP use | TypeScript `getRenameInfo` produced the exact target range for `planTensorStorage` and a localized rejection for the `export` keyword. The range duplicates existing source-location observations unless it is immediately composed with rename edits. | Do not expose the editor protocol phase as an MCP tool. `rename_symbol` sends the native rename request directly and returns no content when the position is not renameable. | Reuse internally |
| Symbol rename already returns source-mapped multi-file edits. | `@volar/language-server@2.4.28/lib/features/languageFeatures.js` — `onRenameRequest`; `@volar/language-service@2.4.28/lib/features/provideRenameEdits.js`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js` — `provideRenameEdits` | The language server delegates `textDocument/rename` to `getRenameEdits`; the language service maps virtual edits back to source documents, merges provider results, and deduplicates text edits. | `rename_symbol` sends the native request and passes its `WorkspaceEdit` directly to the shared host adapter. It implements no rename locations, mapping, merging, or deduplication. | Reuse; directly exercised through MCP |
| Standard rename is selected-project scoped in a multi-project workspace. | `@volar/language-server@2.4.28/lib/project/typescriptProject.js` and `lib/features/languageFeatures.js`; `@volar/typescript@2.4.28/lib/node/proxyLanguageService.js`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js`; complete `@volar/kit@2.4.28` and `@volar/vscode@2.4.28` rename scans; direct source-level MCP rename cases | The server routes `textDocument/rename` to exactly one selected language service. `@volar/typescript` maps `findRenameLocations` through one TypeScript language service; Kit has no project aggregator; the VS Code package only converts the returned editor rename command. One exported-interface rename preserved the old package API through an `as` alias, while a controlled direct cross-project import omitted its consumer. | Preserve the canonical project-scoped contract rather than inventing workspace project orchestration. `rename_symbol` reports the selected `tsconfig` and makes no workspace-wide claim. | Native scope preserved; bespoke aggregation rejected |
| Document and range formatting already return source edits. | `@volar/language-server@2.4.28/lib/features/languageFeatures.js` — `onDocumentFormatting`, `onDocumentRangeFormatting`; `@volar/language-service@2.4.28/lib/features/provideDocumentFormattingEdits.js`; `volar-service-typescript@0.0.71/lib/plugins/syntactic.js` | Both LSP requests call the same Volar formatter, which delegates to TypeScript formatting and maps embedded edits back to the source document. | `format_document` sends the native whole-document request and uses `WorkspaceChange` only to place the returned text edits in the standard edit container accepted by the shared host adapter. | Reuse; directly exercised through MCP |
| Stable TypeScript source actions have exact provider-owned kinds. | `volar-service-typescript@0.0.71/lib/semanticFeatures/codeAction.js`; `codeActionResolve.js`; `@volar/language-server@2.4.28/lib/features/languageFeatures.js` | `source.organizeImports.ts`, `source.removeUnused.ts`, `source.addMissingImports.ts`, and `source.fixAll.ts` each produce one lightweight action. Resolution delegates to TypeScript `organizeImports` or `getCombinedCodeFix` and converts the resulting `FileTextChanges` into an LSP `WorkspaceEdit`. A broad `source` request advertises every action and rewrites each returned kind to the broad requested kind even when resolution later produces no edit. | Expose the four stable intentions as dedicated agent tools that send the exact native kind and resolve its action. Keep generic discovery for provider-dependent quick fixes and refactors; do not expose a broad source-action menu whose entries may be inapplicable. | Reuse through intention-specific MCP entry points |
| MCP edit proposals and native Codex edits can share the same writer. | Codex `apply_patch` runtime and grammar; MCP `WorkspaceEdit` proposal flow; direct source-level MCP use | When an agent passes an MCP-generated patch to Codex's native patch tool, Codex still performs permission checks, contextual verification, visible diff production, multi-file writes, and stale-context rejection. The MCP changes only who calculates the proposed replacements. A deliberately stale returned rename patch was rejected atomically by native `apply_patch`. | Keep the MCP mutation-free. Native Volar/LSP operations calculate edits; the shared host adapter renders them; Codex remains the only writer. | Product boundary; directly verified |
| MCP has no standard file-change result channel. | `@modelcontextprotocol/core@2.0.0-beta.4` `CallToolResultSchema`; Codex MCP result conversion in `codex-rs/protocol/src/models.rs` and native `apply_patch` handler | MCP v2 tool results contain content blocks, optional arbitrary `structuredContent`, error state, and metadata. Codex serializes non-null `structuredContent` as model-visible text; it creates native `FileChange` events only after an `apply_patch` invocation. No standard or Codex-specific result field applies an LSP `WorkspaceEdit`. | A mutation-free standalone MCP must return a representation the agent can pass to the host's native patch tool. Returning a `WorkspaceEdit` alone does not preserve native write mechanics or make it host-applicable. | Confirmed host gap |
| `diff` preserves hunk positions but does not emit Codex change contexts. | `diff@7.0.0/lib/patch/create.js` — `structuredPatch`, `formatPatch`; Codex `codex-apply-patch` grammar | `structuredPatch` returns `oldStart`, `oldLines`, and prefixed hunk lines. `formatPatch` serializes standard `@@ -oldStart,oldLines +newStart,newLines @@` headers. Codex's patch grammar accepts only bare `@@` or a single source line after `@@`; standard hunk coordinates are treated as source text rather than positions. | The shared host adapter retains `structuredPatch` as the upstream diff implementation and translates only the incompatible hunk header grammar. | Confirmed host gap; maintained dependency retained |
| Fixed-size diff context does not preserve an LSP edit's location. | `diff@7.0.0` `structuredPatch`; Codex `codex-apply-patch` parser and `seek_sequence`; direct source-level MCP rename followed by native `apply_patch` | Volar correctly returned edits for the second of two intentionally similar function bodies. The original adapter emitted bare `@@` hunks with three context lines, and Codex's first-match search silently applied both replacements to the first function. Increasing `structuredPatch` context until its old-text sequence first matched at `oldStart` produced a correct patch; the literal returned patch changed only the intended function, and the same running MCP immediately read the new state. | The shared host adapter increases `structuredPatch` context only when the Codex grammar would otherwise select an earlier identical sequence. It performs no diffing or semantic analysis. | Required host-grammar adaptation; directly verified |
| A Codex file move still requires an update hunk. | Codex `codex-apply-patch` grammar; direct source-level `rename_files` MCP result followed by native `apply_patch` | `*** Update File` plus `*** Move to` is rejected when the update action has no hunk. A hunk containing one unchanged source line is accepted and performs a content-preserving move. The same running MCP immediately observed the new path, the removed old path, and Volar's updated importing path. | When `workspace/willRenameFiles` returns no edit for the moved file itself, the host adapter emits one unchanged first-line anchor. It does not alter source content or implement filesystem mutation. Empty-file moves remain unrepresentable by the Codex patch grammar. | Required host-grammar adaptation; directly verified |
| Codex update patches normalize a final newline. | Codex `codex-apply-patch/src/lib.rs` — `derive_new_contents_from_chunks` | The runtime splits source into lines, removes the trailing empty element, applies chunks, then always appends an empty final line before joining. `*** End of File` biases matching to the end; it does not preserve a missing final newline. | Final-newline preservation cannot distinguish native and MCP-generated Codex update patches. The MCP must not claim byte-for-byte preservation that the host patch format itself does not provide. | Host behavior |
| TypeScript code actions intentionally reuse formatting-provider options. | `volar-service-typescript@0.0.71/lib/plugins/semantic.js` — `provideDocumentFormattingEdits`, `provideCodeActions`, and `resolveCodeAction`; `lib/configs/getFormatCodeSettings.js`; `lib/semanticFeatures/codeAction.js`; `codeActionResolve.js`; direct source-level official-client use | The semantic plugin stores the `FormattingOptions` received through its normal formatting provider and passes them to TypeScript quick-fix, refactor, organize-import, and combined-fix operations. Standard `codeAction/resolve` carries no formatting options itself. Without the prior provider call, a multiline import edit was emitted at column zero; sending the native formatting request with two-space options before code-action discovery produced correctly indented native edits. | Code-action tools initialize the provider through `textDocument/formatting` before sending the native action request. They discard the unrelated formatting edit and never rewrite, reindent, or post-process TypeScript's action edit. | Reuse; source-level MCP behavior directly verified |
| Applicable TypeScript refactors are human-readable but their generated edits still require implementation judgment. | `volar-service-typescript@0.0.71/lib/semanticFeatures/codeAction.js` and `codeActionResolve.js`; direct source-level request on a real async action-resolution block | Volar returned applicable extract-function choices and TypeScript correctly derived async flow and captured `actions`, `workspace`, and `signal`. The resolved edit was unformatted and emitted an implicitly typed `workspace` parameter, so applying it would introduce a project diagnostic. | The generic `code_actions` surface preserves these native choices but does not endorse or automatically apply them; the agent still reviews the returned patch and may format it independently. | Native result preserved |
| TypeScript reports unavailable refactors alongside applicable ones. | `volar-service-typescript@0.0.71/lib/semanticFeatures/codeAction.js`; LSP `CodeAction.disabled`; direct source-level official-client use | One real selection returned 15 refactors, of which only `Move to a new file` was applicable. Every unavailable item already carried Volar's exact reason. | `code_actions` preserves the native objects but omits disabled items from the default agent list. `includeUnavailable: true` reveals the complete list and reasons; displayed action numbers always resolve against the same selected view. | Native data with bounded presentation; directly verified |
| Resolvable Volar code actions can be data-only before resolution. | `volar-service-typescript@0.0.71/lib/semanticFeatures/codeAction.js`; `vscode-languageserver-types@3.17.5` `CodeAction.is`; direct official-client MCP use | Volar returns `{ title, kind, data }` when the client advertises edit resolution. The protocol helper rejects that unresolved shape because it requires `edit` or `command`; using it discarded organize-imports before `codeAction/resolve`, producing a false empty result. `Command.is` reliably distinguishes the alternate response member without rejecting the unresolved action. | `code_actions` uses `Command.is` only to reject the alternate command response; every other native action remains eligible for `codeAction/resolve`. A real data-only organize-imports action resolved to its native edit through the MCP. | Reuse; directly verified |
| Pull diagnostics already contain bounded and full human-readable views. | `textDocument/diagnostic`; `vscode-languageserver-protocol@3.17.5` `DocumentDiagnosticReport`; Code Intelligence plain-text diagnostic formatter; direct source-level official-client use | Each diagnostic already carries severity, source, code, exact range, message, tags, code-description link, and related locations. One real file returned two errors; the bounded ambient view showed totals and one complete error, while verbose mode showed both complete errors. | File-observation tools default to one complete actionable diagnostic plus file totals. `includeDiagnostics: "verbose"` exposes the complete native report and `false` suppresses it. This bounds repeated and multi-file observations without reducing the default notice to an unusable count. | Native data with bounded presentation; directly verified |
| Workspace containment is already exported by the language-server package. | `@volar/language-server@2.4.28/node.js`; `lib/project/typescriptProject.js` — `isFileInDir` | The Node entry point publicly re-exports the project helper, which uses platform path semantics to determine whether a file is beneath a directory. | Workspace document lookup reuses `isFileInDir`; relative path rendering remains an agent-presentation concern. | Reuse |
| Volar's server filesystem is the authoritative source-content boundary for language observations. | `@volar/language-server@2.4.28/lib/features/fileSystem.js` and `lib/project/simpleProject.js`; `@volar/typescript@2.4.28/lib/protocol/createSys.js`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js` — `getTextDocument`; direct official-client rename reproduction | The server caches `readFile` results and invalidates them from `didChangeWatchedFiles`. `createLanguageServiceEnvironment` passes that same filesystem to `@volar/typescript.createSys`, and the TypeScript service converts file-rename changes to ranges with documents backed by those snapshots. A separate client-side `stat` or `readFile` can therefore observe a newer filesystem instant than the edit or range it is interpreting. Standard LSP workspace edits do not carry source text or expose the server filesystem. | Expose `server.fileSystem.readFile` through one narrow internal request and use it for source rendering, range excerpts, and workspace-edit application. Keep folding, navigation, rename calculation, snapshots, caching, and invalidation in Volar; the protocol only serializes the already-owned source string across the process boundary. | Reuse with required process-boundary request; stale dependent rename, automatic deletion convergence, folded read, applied move patch, and external dependency excerpt directly verified in one MCP process |
| Source-mapped text edits are already grouped by document. | `@volar/language-service@2.4.28/lib/utils/transform.js` — `transformWorkspaceEdit`, `pushEditToDocumentChanges`; `lib/features/provideRenameEdits.js` — `mergeWorkspaceEdits` | Workspace-edit transformation finds an existing `TextDocumentEdit` for the same URI and appends mapped edits to it; rename merges provider results before returning the source edit. The legacy `changes` lane is inherently keyed by URI. | The host adapter consumes the returned groups as-is and rejects repeated document groups rather than merging or deduplicating them itself. | Reuse; directly exercised |
| `@volar/typescript` is already the TypeScript project substrate. | `@volar/language-server@2.4.28/lib/project/typescriptProjectLs.js`; `@volar/typescript@2.4.28/lib/protocol/createSys.js`; `lib/protocol/createProject.js`; installed dependency graph | The language server calls `createSys` and `createLanguageServiceHost` to supply versioned filesystem state, project scripts, virtual service scripts, snapshots, and module resolution to `volar-service-typescript`. The package exports project and TypeScript-plugin infrastructure, not an additional LSP observation surface. | Keep ownership in `createTypeScriptProject`; a direct MCP dependency or import would duplicate the project boundary without unlocking a native request. | Reuse transitively |
| Module export discovery composes project resolution, synchronized documents, and completion; Volar exposes no separate module-export request. | `@volar/language-server@2.4.28/lib/features/textDocuments.js`; `lib/features/languageFeatures.js` — `onCompletion`; `lib/project/typescriptProject.js`; `lib/project/typescriptProjectLs.js`; `volar-service-typescript@0.0.71/lib/plugins/semantic.js`; `@volar/language-server@2.4.28/protocol.js`; Code Intelligence `ResolveDependencySourceRequest` | A nonexistent synchronized document belongs to an inferred project rather than automatically inheriting another file's configured project. The existing dependency-source request selects the real importing file's Volar service and asks TypeScript's resolver for the exact visible target. `textDocument/completion` delegates to `LanguageService.getCompletionItems`, and the TypeScript service calls `getCompletionsAtPosition`; completion resolution calls `getCompletionEntryDetails`. Standard `didOpen` / `didChange` keep one caller-owned snapshot current, and `didClose` releases it. A namespace-value completion exposes runtime-visible exports, while an import-list completion includes type-only exports. Neither Volar's protocol nor the TypeScript language-service API exposes a direct module-export request. LSP clients, not servers, filter completion lists; Volar returns the provider list and optional `filterText`. | When `fromFile` is supplied, `list_module_exports` first resolves the module through that file's selected Volar project, then asks completion about the exact resolved target from one workspace-scoped synchronized document. Later calls update the same document, resolver-dependent completion and resolution remain serialized, and workspace disposal closes it. It preserves provider order, uses native item kinds to remove the import-list `type` keyword, and applies only case-insensitive `filterText`/label filtering assigned to the client boundary. The filter text is not inserted into the synchronized source. Without a project anchor, an empty page uses native definition lookup on the module specifier to distinguish an unresolved module from no matching exports. It does not parse exports, inspect ASTs, classify TypeScript declarations, mutate a language-service host, manipulate paths, or maintain a second project. | Reuse; runtime/all surfaces, configured workspace-package and local resolution, paging, documentation resolution, unresolved modules, repeated updates, and concurrent calls exercised through one official-client stdio session |
| Volar exposes its active TypeScript resolver inputs without exposing a dependency-source LSP request. | `volar-service-typescript@0.0.71/lib/plugins/semantic.d.ts` and `semantic.js` — injected language service, host, and document filename; `@volar/typescript@2.4.28/lib/protocol/createProject.js`; `typescript@5.9.3` `resolveModuleName` and `noDtsResolution` | The injected host carries Volar's filesystem, project compiler settings, and module cache; the language-service program supplies the consumer file's module mode. TypeScript's `noDtsResolution` selects implementation files, while ordinary resolution covers declaration-only packages. Standard LSP has no request for resolving an arbitrary dependency specifier to that native package result. | One internal request selects the active project, calls TypeScript's resolver, and returns `ResolvedModuleFull` unchanged. The MCP does not resolve packages or read manifests; it only chooses the Semble root from native `packageId.subModuleName`. | Reuse with required process-boundary request; runtime/declaration selection and same-session installation directly verified |
| Volar deduplicates mapped semantic results. | `@volar/language-service@2.4.28/lib/utils/dedupe.js`; `provideDefinition.js`; `provideReferences.js`; `provideCodeActions.js`; `provideFileRenameEdits.js`; `provideCallHierarchyItems.js` | Definitions, references, diagnostics, code actions, file-rename document changes, ranges, prepared call-hierarchy items, and incoming/outgoing call targets are deduplicated after embedded-to-source transformation. | Consume each native result as returned; do not re-deduplicate definitions, type definitions, implementations, or references in `inspect_symbol`. Its only remaining call-group deduplication is across the multiple independently prepared roots that the composed request aggregates, and `Other references` excludes locations already represented by another section rather than altering the native reference result. | Reuse |
| Workspace-symbol query matching is already TypeScript semantic navigation. | `volar-service-typescript@0.0.71/lib/plugins/semantic.js` — `provideWorkspaceSymbols` | Volar delegates the query to TypeScript `getNavigateToItems(query)` and maps the returned symbols to source locations. | The MCP preserves Volar's result order and only applies an optional page boundary. | Reuse |
| MCP request cancellation propagates through the protocol boundary. | `@modelcontextprotocol/server@2.0.0-beta.4` — `ServerContext.mcpReq.signal`; `vscode-languageserver-protocol` `CancellationTokenSource`; direct official-client MCP use | The MCP server aborts the request context signal and the protocol connection translates it into `$/cancelRequest`. | Each request forwards `ctx.mcpReq.signal` to the LSP request. Workspace-process lifetime remains session-scoped and is not tied to one request. | Reuse |
| JSON-RPC already owns concurrent-request state. | `vscode-jsonrpc@8.2.0/lib/common/connection.d.ts` and `connection.js` — `MessageConnection.hasPendingResponse` | The connection reports whether its private `responsePromises` registry is non-empty; response handling removes an entry before settling its promise. It exposes no idle duration or child-process release policy. | Clear the idle timer before sending a request and schedule process release only when `hasPendingResponse()` is false. Do not maintain a second active-request counter. | Reuse pending state; retain host idle policy |
| JSON-RPC request descriptors are runtime-bearing across dependency instances. | `vscode-jsonrpc@8.2.0` and `9.0.1` `connection.js`; `@volar/language-server@2.4.28/protocol.js`; clean installation of the packed MCP and language-server packages | A clean dependency graph can load the MCP transport from `vscode-languageserver-protocol@3.17.5` while Volar's exported request descriptors come from `3.18.2`. Passing the foreign descriptor object makes JSON-RPC reject its distinct `ParameterStructures.auto` instance; the wire method and params remain fully compatible. Version `3.18.2` also replaces the legacy `node.js` package subpath with an exported `node` subpath. | Pin the MCP's node transport dependency to `3.17.5`, retain Volar's native typed request descriptors at the API boundary, and dispatch their standard `method` string through the connection. This preserves native requests without depending on package-instance identity. | Required package-boundary normalization; verified from a packed clean install |

## VS Code adapter affordances

| Finding | Installed source inspected | Objective behavior | FeatureType consequence | Status |
| --- | --- | --- | --- | --- |
| Volar editor commands require client argument conversion. | `@volar/vscode@2.4.28/index.js` — `middleware`, `parseServerCommand`; `@volar/language-service@2.4.28/lib/languageService.js` — command factories | Converts rename and show-references URI/position/location arguments into VS Code objects; `setSelection` is also an editor command. | The MCP returns these commands as explicit follow-up metadata and never sends them to the language server as advertised server commands. | Host-bound |
| Document-drop application requires VS Code data-transfer APIs. | `@volar/vscode@2.4.28/lib/features/documentDropEdits.js` | Converts `additionalEdit`, resolves string/file transfer data through client requests, and supplies binary initial contents for created files. | It is not reusable for headless source patching. | Host-bound |
| Auto insertion requires VS Code snippet insertion. | `@volar/vscode@2.4.28/lib/features/autoInsertion.js` | Requests a Volar auto-insert snippet and inserts it through the active editor. | It is not a plain `WorkspaceEdit` executor. | Host-bound |
| The exported reload-project adapter sends the official notification. | `@volar/vscode@2.4.28/lib/features/reloadProject.js`; `@volar/language-server@2.4.28/protocol.js`; `lib/project/typescriptProject.js`; `lib/project/typescriptProjectLs.js` | The client sends `ReloadProjectNotification`; an owning server may bind it to `project.reload()`, which disposes configured and inferred language services but not the module-level filesystem snapshot map. | Project reload remains valid for explicit recovery, but direct multi-project use proved it does not bound this headless server's memory. It is not used for automatic freshness or memory reclamation. | Insufficient for process memory |
| `writeVirtualFiles.js` is not a usable installed affordance. | `@volar/vscode@2.4.28/lib/features/writeVirtualFiles.js`, package `index.js`, and `protocol.js` | The file references `WriteVirtualFilesNotification`, but the symbol is absent from the installed protocol and the feature is not exported by the package index. | FeatureType does not rely on it. | Not an exported contract |
| Virtual-code laboratory requests are inspection/state controls. | `@volar/language-server@2.4.28/lib/features/editorFeatures.js`; protocol `GetVirtualFileRequest`, `GetVirtualCodeRequest`, state notifications | Returns generated content/mappings and toggles virtual-code or service-plugin state. It performs no disk edit. | The generic TypeScript server supplies no virtual-code-producing language plugin, and the raw request did not complete in direct stdio use. These requests are not exposed by the initial MCP surface. | Deferred |

## Concurrency and MCP protocol affordances

| Finding | Installed source inspected | Objective behavior | FeatureType consequence | Status |
| --- | --- | --- | --- | --- |
| Volar's resolvable requests retain the last selected language service. | `@volar/language-server@2.4.28/lib/features/languageFeatures.js` — `lastCompleteLs`, `lastCodeActionLs`, `lastCallHierarchyLs`, `lastDocumentLinkLs`, and their discovery/follow-up handlers | Completion, code-action, call-hierarchy, and document-link follow-ups are routed through server-local “last language service” slots rather than an identifier carried by the returned item. Concurrent discovery in another TypeScript project can replace that slot before the first request resolves. In one official-client stdio process, a resolved completion page returned full types and documentation alone, then lost both when another project's completion ran concurrently. | Keep each native discovery/follow-up sequence atomic per workspace while leaving independent LSP requests parallel. `VolarWorkspace.runResolverSequence` delegates the cancellation-aware FIFO to `p-queue`; the completion, code-action, call-hierarchy, document-link, and composed symbol-inspection consumers use that boundary without changing any native item. | Upstream server constraint; concurrent before/after behavior directly observed |
| The VS Code/JSON-RPC semaphore cannot cancel queued work. | `vscode-jsonrpc@8.2.0/lib/common/semaphore.js`; `vscode-languageclient@9.0.1/lib/common/utils/async.js` | FIFO queue with capacity and `lock(thunk)` only; no abort signal, timeout, or queued-item removal. The JSON-RPC package main API does not export the semaphore. | FeatureType retains a per-root cancellation-aware queue. | Insufficient contract |
| MCP progress is request-scoped. | `@modelcontextprotocol/sdk@1.28.0/shared/protocol` — `RequestHandlerExtra.sendNotification`; MCP progress schemas | A caller supplies a progress token; related notifications carry progress, total, and message. | Mutation tools report bounded lock/generation/confirmation/prepare/commit/refresh/completion phases only when requested. | Reuse |
| MCP roots are client-owned and change-notified. | MCP SDK `Server.listRoots`; `RootsListChangedNotificationSchema` | A capable client answers `roots/list` and can notify changes. | FeatureType lazily adopts file roots and refreshes them on list changes; manual attachment remains an override. | Reuse |
| MCP form elicitation has backward-compatible capability rules. | MCP SDK `getSupportedElicitationModes`; `Server.elicitInput` | An empty elicitation capability supports form mode; URL-only support does not imply form support. | Required LSP change annotations use the SDK capability helper and a boolean confirmation form. | Reuse |
| MCP task tools manage request lifetime, not workspace edits. | MCP SDK experimental task interfaces and task server | Creates, stores, polls, and returns task results. It defines no source edit, filesystem, permission, transaction, or host-diff contract. | Editing remains synchronous and stateless with progress; tasks do not replace the applier. | Insufficient contract |

## Proven custom boundary

No installed package above exposes a reusable headless function that accepts an
LSP `WorkspaceEdit` and applies ordered text plus regular-file resource
operations with all of these properties:

- `documentChanges` precedence and ordering
- document versions and exact content/mode baselines
- required annotation confirmation
- valid UTF-8 enforcement
- workspace-root and Codex grant enforcement
- create/overwrite/ignore option semantics
- real filesystem rename
- rollback across text and resource operations
- cancellation while queued
- language-server refresh and apply-result acknowledgment

`packages/mcp/src/editing/workspace-edit.ts` owns only that client/host boundary
and the exact-intent compiler that feeds it. Semantic edit reasoning remains in
Volar.

## Executable evidence

The following current tests validate the resulting ownership decisions:

- `packages/mcp/src/editing/workspace-edit.test.ts` covers precedence, stable
  insertion ordering, overlap delegation, versions, annotations, confirmation,
  missing annotation rejection, create/rename ordering, overwrite precedence,
  inode/mode preservation, umask, invalid UTF-8 input and output, stale content
  and permission revisions, sandbox grants, symlink rejection, rollback,
  refresh warnings, cancellation before commit, and cancellation while queued.
- `packages/mcp/src/tools/refactors.test.ts` covers native edit summaries,
  protocol precedence, and physical move composition.
- `packages/mcp/src/tools/workspace-edits.test.ts` covers preview precedence.
- `packages/mcp/src/integration.test.ts` covers MCP client roots, bounded
  progress, exact multi-file edits, Volar symbol rename, file move, lazy selected
  code-action application, resolved editor-command follow-up, formatting,
  workspace-symbol implementation bodies including overloads, direct
  call-hierarchy callees, project reload, in-memory transport, and stdio
  transport.
- `packages/mcp/src/smoke.ts` is the codified in-memory/stdio executable probe;
  each lane resolves a real TypeScript hover and applies, verifies, and removes
  an ephemeral edit.
