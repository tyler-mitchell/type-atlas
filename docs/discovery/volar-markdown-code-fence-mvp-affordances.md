# Volar `.featuretype` Code Fence Symbol Research

Maintainer research notes for the MVP where `.featuretype` files host Markdown-style TypeScript fences and Featuretype MCP `inspect_symbol` works from source positions inside those fences.

## Implemented MVP status

Records the implemented source path and the verification surface now expected for this MVP.

```ts
// Source: packages/core/src/parseFeatureDocument.ts
// Source: packages/service/src/languagePlugin.ts

const document = parseFeatureDocument({
  filePath: "/repo/docs/example.featuretype",
  source,
})

const embeddedCodes = document.codeBlocks.map(
  (codeBlock) => new FeatureCodeVirtualCode(codeBlock),
)

function getExtraServiceScripts(fileName: string, root: FeatureTypeVirtualCode) {
  return root.embeddedCodes.map((code) => ({
    // Valid file= values become import-resolvable sibling TypeScript modules.
    fileName: code.codeBlock.fileName ?? createSyntheticFileName(fileName, code),
    code,
    extension: code.codeBlock.language === "tsx" ? ".tsx" : ".ts",
    scriptKind: code.codeBlock.language === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  }))
}
```

```ts
// Source: packages/service/src/servicePlugin.ts

function provideDiagnostics(document: TextDocument) {
  const root = getFeatureTypeRoot(context, document.uri)
  return root?.document.errors.map((error) => toDiagnostic(document, error))
}

function provideDocumentSymbols(document: TextDocument) {
  const root = getFeatureTypeRoot(context, document.uri)
  return root?.document.codeBlocks.map((codeBlock) =>
    toDocumentSymbol(document, codeBlock)
  )
}
```

```ts
// Source: apps/vscode-extension/src/extension.ts
// Volar first-server/starter pattern: VS Code client starts the language server,
// passes the workspace TypeScript SDK, and exposes Volar Labs metadata.

const tsdk = await getTsdk(context)

const client = new LanguageClient(
  "featuretype-language-server",
  "FeatureType Language Server",
  serverOptions,
  {
    documentSelector: [{ language: "featuretype" }],
    initializationOptions: {
      typescript: { tsdk: tsdk.tsdk },
    },
  },
)

const labsInfo = createLabsInfo(serverProtocol)
labsInfo.addLanguageClient(client)
```

```jsonc
// Source: apps/vscode-extension/package.json
{
  "activationEvents": ["onLanguage:featuretype"],
  "contributes": {
    "languages": [{ "id": "featuretype", "extensions": [".featuretype"] }],
    "grammars": [
      {
        "language": "featuretype",
        "embeddedLanguages": {
          "source.ts": "typescript",
          "source.tsx": "typescriptreact"
        }
      }
    ]
  }
}
```

```sh
pnpm --filter @featuretype/core test
pnpm --filter @featuretype/service test
pnpm --filter @featuretype/language-server test
pnpm --filter @featuretype/mcp test:integration
pnpm --filter featuretype-language-features test:vscode
pnpm --filter featuretype-language-features build
pnpm --filter @featuretype/service build && pnpm --filter @featuretype/language-server build && pnpm --filter @featuretype/mcp build
pnpm --filter @featuretype/mcp probe:in-memory
```

The VS Code extension follows the official Volar client shape documented in the Volar first-server guide and mirrored by `volarjs/starter`: `@volar/vscode` supplies the client helpers, the extension activates on the custom language id, and the language server owns the embedded-code semantics.

## Witnessed verification status

Records the proof surfaces added after the first MVP pass.

```ts
// Source: packages/service/src/languagePlugin.test.ts
// The service test uses @volar/test-utils printSnapshot to witness the raw
// fence virtual code and one-to-one source-map coordinates before LSP features
// consume them.

const root = new FeatureTypeVirtualCode(
  URI.file("/workspace/docs/example.featuretype"),
  createSnapshot(source),
)

const rootCode = root.embeddedCodes[0]
const snapshot = [...printSnapshot({ snapshot: root.snapshot }, rootCode)]
  .join("\n")

expect(snapshot).toContain("[1] import·{·helper·}·from·\"./helper\"")
expect(snapshot).toContain("[6] (exact match) (:6:1)")
expect(snapshot).toContain("[3] export·const·root·=·helper(\"ok\")")
expect(snapshot).toContain("[8] export·const·root·=·helper(\"ok\")↵ (:8:1)")
```

```ts
// Source: packages/language-server/test/diagnostics.test.ts
// @volar/test-utils starts the FeatureType language server and opens authored
// .featuretype documents. These are editor/LSP-shaped requests, not direct
// parser calls.

await serverHandle.openTextDocument(
  fixturePath("same-file-import.featuretype"),
  "featuretype",
)

await serverHandle.sendHoverRequest(document.uri, helperPosition)
await serverHandle.sendDefinitionRequest(document.uri, helperPosition)
await serverHandle.sendReferencesRequest(document.uri, helperPosition, {
  includeDeclaration: true,
})

// Proven in this harness:
// - TypeScript diagnostics map back to fenced source lines.
// - Same-file extensionless imports resolve across file= fences.
// - Definitions and references report .featuretype URIs, not virtual .ts paths.
// - Document symbols expose fence modules plus TypeScript child symbols.
// - file= module identity refreshes after document-only edits and watched-file notifications.
// - Package imports resolve through normal TypeScript resolution when each
//   virtual module has the imports it uses.
```

```ts
// Source: apps/vscode-extension/scripts/build.ts
// Source: apps/vscode-extension/src/test/suite/index.ts
// The VS Code extension verification launches VS Code with the extension
// development path, activates the extension, and asks VS Code for editor-visible
// hover, definition, and diagnostics inside .featuretype fences.

const serverEntry = "../../packages/language-server/src/server.ts"

await runTests({
  extensionDevelopmentPath: extensionRoot,
  extensionTestsPath: testRunnerPath,
  launchArgs: [path.join(repoRoot, "fixtures", "demo-workspace")],
  vscodeExecutablePath,
})

await vscode.commands.executeCommand(
  "vscode.executeHoverProvider",
  sameFileUri,
  helperPosition,
)

await vscode.commands.executeCommand(
  "vscode.executeDefinitionProvider",
  sameFileUri,
  helperPosition,
)

vscode.languages.getDiagnostics(brokenUri)
```

The VS Code verification caught and fixed an extension-only bug: the bundled `dist/server.js` entry had been built from the library export entry instead of the language-server process entry. The extension now bundles `packages/language-server/src/server.ts`, so `client.start()` receives a real LSP initialize response.

```ts
// Source: packages/mcp/src/integration.test.ts
// MCP proof now covers both position and query entry points for the same
// source-mapped Volar behavior.

await client.callTool({
  name: "inspect_symbol",
  arguments: {
    file: "same-file-import.featuretype",
    line: 6,
    col: 22,
    maxReferences: 5,
  },
})

await client.callTool({
  name: "inspect_symbol",
  arguments: {
    file: "same-file-import.featuretype",
    query: "helper",
    maxReferences: 5,
  },
})

await client.callTool({
  name: "get_document_symbols",
  arguments: {
    file: "same-file-import.featuretype",
    maxDepth: 2,
  },
})
```

MCP diagnostics now preserve Featuretype-owned string diagnostic codes such as `invalid-fence-file` and `duplicate-fence-file` instead of formatting them as TypeScript numeric diagnostics.

## Volar-native verification lanes

Defines what counts as proof for `.featuretype` Volar behavior.

```txt
Authoritative testing reference:
docs/discovery/volarjs-testing-verification.md

Required proof ladder:
1. virtual-code mapping proof with @volar/test-utils printSnapshot
2. headless LSP proof with @volar/test-utils startLanguageServer
3. VS Code extension-host proof with @vscode/test-electron
4. Volar Labs inspection for running-server virtual files and source maps
5. manual UI proof only when a real language feature result is visible
```

## MVP authored file contract

Defines the authored document shape: prose is ordinary `.featuretype` content, while each TypeScript fence declares a same-file virtual module.

````md
# Example Featuretype Document

Markdown prose is not TypeScript and does not need semantic tooling for the MVP.

## Root module

```ts file="./root.ts"
import { helper } from "./helper"

export const root = helper("root")
```

## Helper module

```ts file="./helper.ts"
export const helper = (value: string) => value.toUpperCase()
```
````

Same-file fence-to-fence imports are the required import target. Package imports are not a custom Featuretype resolver responsibility; the language-server harness now proves they work through ordinary TypeScript project resolution when the virtual module imports the package symbols it uses.

## MCP symbol command

Shows the single MCP behavior the MVP must preserve from the caller's point of view.

```ts
// Source: packages/mcp/src/server.ts
// Source: packages/mcp/src/tools/symbols.ts
// Source: docs/implementation/mcp-navigation.md

type InspectSymbolInput = {
  file: "docs/example.featuretype"
  line: number
  col: number
  maxReferences?: number
}

async function inspectFeaturetypeFenceSymbol(input: InspectSymbolInput) {
  // The caller points at the authored .featuretype file, not at a generated file.
  // The position is a source position inside a ```ts or ```tsx fence.
  return inspectSymbol(session, input)
}

async function inspectSymbol(session: DiagnosticsSession, args: InspectSymbolInput) {
  const absPath = resolve(session.rootDir, args.file)
  const position = { line: args.line - 1, character: args.col - 1 }

  const [
    hover,
    signatureHelp,
    definitions,
    typeDefinitions,
    implementations,
    references,
  ] = await Promise.all([
    session.getFileHover(absPath, position),
    session.getFileSignatureHelp(absPath, position),
    session.getFileDefinition(absPath, position),
    session.getFileTypeDefinition(absPath, position),
    session.getFileImplementations(absPath, position),
    session.getFileReferences(absPath, position),
  ])

  // MVP success means these calls work through Volar's source-to-virtual mappings.
  return formatInspectSymbolResult({
    hover,
    signatureHelp,
    definitions,
    typeDefinitions,
    implementations,
    references,
  })
}
```

Position-based `inspect_symbol` is the MVP path; query-based matching can remain best-effort until document symbols are intentionally shaped for fenced modules.

## MCP empty-position behavior

Shows the current `inspect_symbol` behavior when Volar returns no semantic information.

```ts
// Source: packages/mcp/src/tools/symbols.ts

const [hover, signatureHelp, definitions, typeDefinitions, implementations, references] = await Promise.all([
  session.getFileHover(absPath, resolvedPosition),
  session.getFileSignatureHelp(absPath, resolvedPosition),
  session.getFileDefinition(absPath, resolvedPosition),
  session.getFileTypeDefinition(absPath, resolvedPosition),
  session.getFileImplementations(absPath, resolvedPosition),
  session.getFileReferences(absPath, resolvedPosition),
])

if (
  !hover &&
  definitions.length === 0 &&
  typeDefinitions.length === 0 &&
  implementations.length === 0 &&
  references.length === 0
) {
  return explainFailure("inspect_symbol", args.file, session, {
    position: `${resolvedPosition.line + 1}:${resolvedPosition.character + 1}`,
    hint: query ? `No semantic information was found for "${query}".` : undefined,
  })
}
```

```ts
// Source: packages/language-server/src/diagnostics.ts

const diagnosticsSession: DiagnosticsSession = {
  getFileHover(filePath, position) {
    return client.getDocumentHover(filePath, position)
  },

  getFileDefinition(filePath, position) {
    return client.getDocumentDefinition(filePath, position)
  },

  getFileReferences(filePath, position) {
    return client.getDocumentReferences(filePath, position)
  },
}
```

The MVP can keep the existing empty-result path for prose, fence delimiters, and invalid positions. A nicer "not inside a TypeScript fence" message is possible later, but it is not required for source-position symbol introspection.

## Current MCP session route

Documents where Featuretype MCP already hands symbol requests to the Volar-backed diagnostics session.

```ts
// Source: packages/language-server/src/diagnostics.ts

interface DiagnosticsSession {
  getFileHover(filePath: string, position: Position): Promise<Hover | null>
  getFileSignatureHelp(filePath: string, position: Position): Promise<SignatureHelp | null>
  getFileDefinition(filePath: string, position: Position): Promise<Array<Location | LocationLink>>
  getFileReferences(filePath: string, position: Position): Promise<Location[]>
  getFileTypeDefinition(filePath: string, position: Position): Promise<Array<Location | LocationLink>>
  getFileImplementations(filePath: string, position: Position): Promise<Array<Location | LocationLink>>
}

const sessionMethods = {
  getFileHover(filePath: string, position: Position) {
    return client.getDocumentHover(filePath, position)
  },
  getFileSignatureHelp(filePath: string, position: Position) {
    return client.getDocumentSignatureHelp(filePath, position)
  },
  getFileDefinition(filePath: string, position: Position) {
    return client.getDocumentDefinition(filePath, position)
  },
  getFileReferences(filePath: string, position: Position) {
    return client.getDocumentReferences(filePath, position)
  },
  getFileTypeDefinition(filePath: string, position: Position) {
    return client.getDocumentTypeDefinition(filePath, position)
  },
  getFileImplementations(filePath: string, position: Position) {
    return client.getDocumentImplementations(filePath, position)
  },
}
```

No new MCP command is needed for the MVP; the work is making the existing document route semantically meaningful for `.featuretype` fence positions.

## Current project inclusion

Shows the existing affordance that already puts `.featuretype` files into the diagnostics project graph.

```ts
// Source: packages/language-server/src/diagnostics.ts
// Source: packages/language-server/src/server.ts

function enumerateProjectFiles(rootDir: string): string[] {
  const files = new Set(collectReferencedProjectFilesFromTsconfig(rootDir))

  for (const fileName of findFeatureTypeFiles(rootDir)) {
    files.add(fileName)
  }

  return [...files].filter(isSupportedDiagnosticFile)
}

function isSupportedDiagnosticFile(fileName: string): boolean {
  return [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".featuretype",
  ].some((suffix) => fileName.endsWith(suffix)) || fileName.endsWith(".d.ts")
}

connection.onInitialized(() => {
  server.fileWatcher.watchFiles(["**/*.{featuretype,ts,tsx,js,jsx,json}"])
})
```

The source `.featuretype` document already has a path into the language server; the MVP changes what virtual TypeScript is generated from that source.

## Dormant implementation affordance

Captures the existing repo-local Volar pattern without treating its old block syntax as the new authoring model.

```ts
// Source: packages/service/src/languagePlugin.ts
// Source: docs/archive/featuretype-vscode-mvp.md

import type { CodeMapping, LanguagePlugin, VirtualCode } from "@volar/language-core"
import type { TypeScriptExtraServiceScript } from "@volar/typescript"
import type * as ts from "typescript"
import { URI } from "vscode-uri"

export function createFeatureTypeLanguagePlugin(): LanguagePlugin<URI> {
  return {
    getLanguageId(uri) {
      return uri.path.endsWith(".featuretype") ? "featuretype" : undefined
    },

    createVirtualCode(uri, languageId, snapshot) {
      return languageId === "featuretype"
        ? new FeatureTypeVirtualCode(uri, snapshot)
        : undefined
    },

    typescript: {
      extraFileExtensions: [
        {
          extension: "featuretype",
          isMixedContent: true,
          scriptKind: 7,
        },
      ],

      getServiceScript() {
        // Existing code keeps the root .featuretype file out of direct TS service mode.
        return undefined
      },

      getExtraServiceScripts(fileName, root) {
        if (!(root instanceof FeatureTypeVirtualCode)) {
          return []
        }

        return root.embeddedCodes.map<TypeScriptExtraServiceScript>((code) => ({
          fileName: `${fileName}.${code.id}${getScriptExtension(code.codeBlock.language)}`,
          code,
          extension: getScriptExtension(code.codeBlock.language),
          scriptKind: getScriptKind(code.codeBlock.language),
        }))
      },
    },
  }
}
```

The dormant parser and old block vocabulary are not the MVP, but `LanguagePlugin`, `VirtualCode`, mappings, and `getExtraServiceScripts` are directly reusable affordances.

## Authored fence parser output

Defines the data the new `.featuretype` parser needs to produce before Volar code generation.

```ts
// Target shape for the Markdown-style parser.
// Provenance: current FeatureTypeVirtualCode consumes document.codeBlocks.
// Constraint: keep this as parser data; do not encode Volar details here.

type FeaturetypeFenceLanguage = "ts" | "tsx"

type FeaturetypeCodeFence = {
  language: FeaturetypeFenceLanguage

  // Required for same-file imports in the MVP.
  // Example source fence: ```ts file="./helper.ts"
  moduleSpecifier: `./${string}.ts` | `./${string}.tsx`

  // Absolute source offsets in the authored .featuretype file.
  sourceStart: number
  sourceEnd: number
  codeStart: number
  codeEnd: number

  code: string
}

type ParsedFeaturetypeDocument = {
  filePath: string
  source: string
  fences: FeaturetypeCodeFence[]
}
```

Requiring `file="./name.ts"` is the clean MVP path for importable same-file fence modules.

## Virtual module identity

Defines the TypeScript file identities that let imports between fences resolve through the normal TypeScript host.

```ts
// Source: @volar/typescript index.d.ts
// Source: @volar/typescript/lib/protocol/createProject.js

type FenceVirtualModule = TypeScriptExtraServiceScript & {
  // For /repo/docs/example.featuretype with a fence `file="./helper.ts"`,
  // use an import-resolvable virtual file path in the same directory:
  fileName: "/repo/docs/helper.ts"

  code: VirtualCode
  extension: ".ts" | ".tsx"
  scriptKind: ts.ScriptKind.TS | ts.ScriptKind.TSX
}

function getExtraServiceScripts(
  sourceFeaturetypeFileName: "/repo/docs/example.featuretype",
  root: FeaturetypeMarkdownVirtualCode,
): TypeScriptExtraServiceScript[] {
  return root.fences.map((fence) => ({
    // Same-file import target:
    // import { helper } from "./helper"
    // containingFile: /repo/docs/root.ts
    // resolvedFileName: /repo/docs/helper.ts
    fileName: resolve(dirname(sourceFeaturetypeFileName), fence.moduleSpecifier),
    code: new FenceVirtualCode(fence),
    extension: fence.language === "tsx" ? ".tsx" : ".ts",
    scriptKind: fence.language === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  }))
}
```

This is the central same-file import affordance: extra service scripts are registered as TypeScript files, and TypeScript module resolution asks the Volar host whether those file names exist.

## Fence module contract

Defines the recommended authored contract for importable TypeScript fences.

````md
```ts file="./root.ts"
import { helper } from "./helper"

export const root = helper("root")
```

```ts file="./helper.ts"
export const helper = (value: string) => value.toUpperCase()
```
````

The fence `file=` value defines the virtual TypeScript module path. The import specifier still follows the workspace TypeScript resolver. Extensionless imports such as `./helper` are the safest default; explicit `.ts` imports should work only when the workspace compiler options allow TypeScript extension imports.

| Contract point | MVP rule |
| --- | --- |
| Importable fence | A TS/TSX fence needs `file="./name.ts"` or `file="./name.tsx"` to be imported by another fence. |
| Anonymous fence | A TS/TSX fence without `file=` may still be type checked through an internal synthetic file name, but it is not importable by authored code in the MVP. |
| Path shape | `file=` must be a relative same-directory or child-path specifier beginning with `./`. Absolute paths, URL-like values, query strings, hashes, and parent traversal are structural errors. |
| Extension | `.ts` fences use `.ts`; `.tsx` fences use `.tsx`. Extensionless `file=` values are structural errors for the MVP because the virtual module identity must be explicit. |
| Normalization | Normalize against the containing `.featuretype` file's directory and compare through Volar's case-aware `FileMap` behavior. |
| Duplicates | Two fences with the same normalized virtual file name are structural errors. |
| Real-file shadowing | A fence whose normalized virtual file name already exists on disk is a structural error unless a later product decision explicitly chooses shadowing. |

This keeps same-file imports ordinary from TypeScript's point of view while preventing Volar's registry overwrite behavior from becoming a hidden authoring trap.

## TypeScript host registration

Shows why `getExtraServiceScripts` can support same-file fence imports without writing files to disk.

```ts
// Source: @volar/typescript/lib/protocol/createProject.js

function sync() {
  extraScriptRegistry.clear()

  const tsFileNamesSet = new Set<string>()

  for (const fileName of projectHost.getScriptFileNames()) {
    const sourceScript = language.scripts.get(asScriptId(fileName))

    for (const extraServiceScript of sourceScript?.generated?.languagePlugin.typescript
      ?.getExtraServiceScripts?.(fileName, sourceScript.generated.root) ?? []) {
      tsFileNamesSet.add(extraServiceScript.fileName)
      extraScriptRegistry.set(extraServiceScript.fileName, extraServiceScript)
    }
  }

  tsFileRegistry = new FileMap(tsFileNamesSet)
}

const languageServiceHost = {
  fileExists(fileName: string) {
    return getScriptVersion(fileName) !== ""
  },

  readFile(fileName: string) {
    const snapshot = getScriptSnapshot(fileName)
    return snapshot?.getText(0, snapshot.getLength())
  },

  getScriptSnapshot(fileName: string) {
    if (extraScriptRegistry.has(fileName)) {
      return extraScriptRegistry.get(fileName).code.snapshot
    }
  },

  getScriptFileNames() {
    return [...tsFileRegistry.keys()]
  },
}
```

Because all fences from one `.featuretype` source register during the same sync pass, `./helper.ts` can resolve to a sibling extra service script.

## Virtual module shadowing boundary

Shows why Featuretype must own duplicate and real-file collision diagnostics.

```ts
// Source: @volar/typescript/lib/protocol/createProject.js

function getScriptSnapshot(fileName: string) {
  sync()

  if (extraScriptRegistry.has(fileName)) {
    // Extra service scripts are read before source scripts or disk files.
    return extraScriptRegistry.get(fileName).code.snapshot
  }

  const sourceScript = language.scripts.get(asScriptId(fileName))
  if (sourceScript?.generated) {
    const serviceScript = sourceScript.generated.languagePlugin.typescript?.getServiceScript(
      sourceScript.generated.root,
    )

    if (serviceScript) {
      return serviceScript.code.snapshot
    }
  }

  if (sys.fileExists(fileName)) {
    return ts.ScriptSnapshot.fromString(sys.readFile(fileName) ?? "")
  }
}
```

```ts
// Source: @volar/language-core/lib/utils.js

class FileMap<T> extends Map<string, T> {
  set(key: string, value: T) {
    this.originalFileNames.set(this.normalizeId(key), key)

    // The normalized key is the collision domain.
    return super.set(this.normalizeId(key), value)
  }

  normalizeId(id: string) {
    return this.caseSensitive ? id : id.toLowerCase()
  }
}
```

```ts
// Source: @volar/typescript/lib/protocol/createProject.js

for (const extraServiceScript of getExtraServiceScripts(fileName, root) ?? []) {
  // FileMap#set overwrites an existing entry for the same normalized file name.
  extraScriptRegistry.set(extraServiceScript.fileName, extraServiceScript)
}
```

Volar gives Featuretype the power to make a fence importable as `/repo/docs/helper.ts`; it does not choose whether that virtual module may duplicate another fence or shadow a real `helper.ts` file.

## Same-file import resolution

Documents the exact import resolution path the MVP should lean on.

```ts
// Source: @volar/typescript/lib/protocol/createProject.js
// Source: @volar/typescript/lib/resolveModuleName.js

const containingFile = "/repo/docs/root.ts"
const importText = "./helper.ts"

const resolved = ts.resolveModuleName(
  importText,
  containingFile,
  compilerOptions,
  moduleResolutionHost,
  moduleResolutionCache,
)

const moduleResolutionHost = {
  fileExists(fileName: string) {
    // For /repo/docs/helper.ts, this reaches Volar's extraScriptRegistry.
    return languageServiceHost.fileExists(fileName)
  },

  readFile(fileName: string) {
    // For /repo/docs/helper.ts, this reads the virtual fence snapshot.
    return languageServiceHost.readFile(fileName)
  },

  directoryExists(directoryName: string) {
    // createProject tracks virtual script directories in tsFileDirRegistry.
    return tsFileDirRegistry.has(directoryName) || sys.directoryExists(directoryName)
  },
}
```

Package imports can succeed through normal TypeScript resolution if the package exists in the project graph, but the MVP contract is same-file fence imports.

## Root virtual code

Defines the source document virtual root that owns all fence virtual modules.

```ts
// Source: @volar/language-core lib/types.d.ts
// Source: packages/service/src/languagePlugin.ts

class FeaturetypeMarkdownVirtualCode implements VirtualCode {
  id = "root"
  languageId = "featuretype"
  snapshot: ts.IScriptSnapshot

  // Identity map keeps the source document available for structural service plugins.
  mappings: CodeMapping[] = [sourceIdentityMapping()]

  // Each authored TS/TSX fence becomes an embedded VirtualCode.
  embeddedCodes: FenceVirtualCode[]

  constructor(
    readonly uri: URI,
    snapshot: ts.IScriptSnapshot,
    parsed: ParsedFeaturetypeDocument,
  ) {
    this.snapshot = snapshot
    this.embeddedCodes = parsed.fences.map((fence) => new FenceVirtualCode(fence))
  }
}
```

The root `.featuretype` virtual code should stay source-shaped; the TypeScript service scripts are the embedded fence codes.

## Fence virtual code

Defines the generated TypeScript code for each fence.

```ts
// Source: @volar/language-core lib/types.d.ts
// Source: packages/service/src/languagePlugin.ts

class FenceVirtualCode implements VirtualCode {
  readonly id: string
  readonly languageId: "typescript" | "typescriptreact"
  readonly snapshot: ts.IScriptSnapshot
  readonly mappings: CodeMapping[]
  readonly embeddedCodes: VirtualCode[] = []

  constructor(readonly fence: FeaturetypeCodeFence) {
    this.id = createStableFenceId(fence.moduleSpecifier)
    this.languageId = fence.language === "tsx" ? "typescriptreact" : "typescript"

    // The MVP should preserve authored code offsets exactly.
    // Avoid wrappers unless a later feature proves they are necessary.
    this.snapshot = createSnapshot(fence.code)

    this.mappings = [
      {
        sourceOffsets: [fence.codeStart],
        generatedOffsets: [0],
        lengths: [fence.code.length],
        data: inspectSymbolMappingData,
      },
    ]
  }
}

const inspectSymbolMappingData: CodeInformation = {
  // Hover depends on semantic.
  semantic: true,

  // Definition, type definition, implementation, references, highlights,
  // call hierarchy, and type hierarchy depend on navigation.
  navigation: true,

  // Signature help depends on completion in Volar's editor affordance flags.
  completion: true,

  // Diagnostics are not the first MCP command, but type safety requires this.
  verification: true,

  // Symbols are secondary for position-based inspect_symbol, but useful for query fallback.
  structure: true,

  format: true,
}
```

Wrappers create offset and scope complexity; same-file TypeScript modules should start as raw fenced code.

## Mapping gates for `inspect_symbol`

Documents the Volar flags that gate the six calls used by MCP `inspect_symbol`.

```ts
// Source: @volar/language-core/lib/editor.js

const volarFeatureFlags = {
  hover: (info: CodeInformation) => Boolean(info.semantic),
  signatureHelp: (info: CodeInformation) => Boolean(info.completion),
  definition: (info: CodeInformation) => Boolean(info.navigation),
  typeDefinition: (info: CodeInformation) => Boolean(info.navigation),
  references: (info: CodeInformation) => Boolean(info.navigation),
  implementation: (info: CodeInformation) => Boolean(info.navigation),
  diagnostics: (info: CodeInformation) => Boolean(info.verification),
  documentSymbols: (info: CodeInformation) => Boolean(info.structure),
}
```

The minimum mapping data for the MVP is `semantic`, `navigation`, and `completion`; `verification` is needed for real type safety.

## Source-to-virtual position flow

Shows how Volar turns a `.featuretype` source position into a TypeScript service position.

```ts
// Source: @volar/language-service/lib/utils/featureWorkers.js

async function languageFeatureWorker(context, uri, position) {
  const sourceScript = context.language.scripts.get(uri)

  for (const docs of forEachEmbeddedDocument(
    context,
    sourceScript,
    sourceScript.generated.root,
  )) {
    const [sourceDocument, embeddedDocument, map] = docs

    for (const generatedPosition of getGeneratedPositions(
      [sourceDocument, embeddedDocument, map],
      position,
      isHoverEnabled,
    )) {
      // The TypeScript plugin receives the embedded virtual TypeScript document.
      await plugin.provideHover(embeddedDocument, generatedPosition)
    }
  }
}
```

This is why the MCP input remains the authored `.featuretype` file and source line/column.

## Virtual-to-source result flow

Shows how Volar maps TypeScript results back to authored `.featuretype` ranges.

```ts
// Source: @volar/language-service/lib/features/provideHover.js
// Source: @volar/language-service/lib/features/provideDefinition.js
// Source: @volar/language-service/lib/features/provideReferences.js

function mapHoverResultToSource(item: Hover, docs: DocumentsAndMap) {
  item.range = getSourceRange(docs, item.range, isHoverEnabled)
  return item
}

function mapDefinitionTargetToSource(link: LocationLink, context: LanguageServiceContext) {
  const decoded = context.decodeEmbeddedDocumentUri(URI.parse(link.targetUri))
  const sourceScript = decoded && context.language.scripts.get(decoded[0])
  const targetVirtualFile = decoded && sourceScript?.generated?.embeddedCodes.get(decoded[1])

  for (const [targetScript, targetSourceMap] of context.language.maps.forEach(targetVirtualFile)) {
    const sourceDocument = context.documents.get(
      targetScript.id,
      targetScript.languageId,
      targetScript.snapshot,
    )
    const embeddedDocument = context.documents.get(
      context.encodeEmbeddedDocumentUri(sourceScript.id, targetVirtualFile.id),
      targetVirtualFile.languageId,
      targetVirtualFile.snapshot,
    )

    link.targetUri = sourceDocument.uri
    link.targetRange = getSourceRange(
      [sourceDocument, embeddedDocument, targetSourceMap],
      link.targetRange,
    )
    link.targetSelectionRange = getSourceRange(
      [sourceDocument, embeddedDocument, targetSourceMap],
      link.targetSelectionRange,
    )
  }

  return link
}
```

For fence-to-fence imports, definition and references should land back in the same `.featuretype` file at the target fence's source range.

## TypeScript service plugin affordance

Records the service plugin that gives Volar the TypeScript language features used by `inspect_symbol`.

```ts
// Source: packages/language-server/src/server.ts
// Source: volar-service-typescript index.d.ts

import { createTypeScriptProject } from "@volar/language-server/node.js"
import { create as createTypeScriptServices } from "volar-service-typescript"

connection.onInitialize((params) => {
  const tsdk = loadTsdkByPath(params.initializationOptions.typescript.tsdk, params.locale)

  return server.initialize(
    params,
    createTypeScriptProject(tsdk.typescript, tsdk.diagnosticMessages, () => ({
      languagePlugins: [featureTypeLanguagePlugin],
    })),
    [
      // Provides hover, definition, references, type definitions,
      // implementations, diagnostics, signature help, and completions.
      ...createTypeScriptServices(tsdk.typescript),
      createFeatureTypeServicePlugin(),
    ],
  )
})
```

The MVP should compose this service path instead of adding a custom semantic engine.

## Volar TypeScript project affordance

Captures why `createTypeScriptProject` is the right project host for this MVP.

```ts
// Source: @volar/language-server/lib/project/typescriptProject.d.ts

function createTypeScriptProject(
  ts: typeof import("typescript"),
  tsLocalized: ts.MapLike<string> | undefined,
  create: (projectContext: ProjectExposeContext) => ProviderResult<{
    languagePlugins: LanguagePlugin<URI>[]
    setup?(options: {
      language: Language
      project: ProjectContext
    }): void
  }>,
): LanguageServerProject
```

The MVP needs real TypeScript project semantics because same-file fence imports should use TypeScript module resolution, not a separate bespoke linker.

## Extra service script affordance

Records the exact Volar API that turns embedded fences into TypeScript service files.

```ts
// Source: @volar/typescript/index.d.ts

interface TypeScriptGenericOptions {
  extraFileExtensions: ts.FileExtensionInfo[]
  resolveHiddenExtensions?: boolean
  getServiceScript(root: VirtualCode): TypeScriptServiceScript | undefined
}

interface TypeScriptNonTSPluginOptions {
  getExtraServiceScripts?(
    fileName: string,
    root: VirtualCode,
  ): TypeScriptExtraServiceScript[]
}

interface TypeScriptExtraServiceScript extends TypeScriptServiceScript {
  fileName: string
}

interface TypeScriptServiceScript {
  code: VirtualCode
  extension: ".ts" | ".tsx" | ".js" | ".jsx" | string
  scriptKind: ts.ScriptKind
  preventLeadingOffset?: boolean
}
```

`getExtraServiceScripts` is available in the language-server path; upstream source warns it is not available in TypeScript-plugin-only mode.

## Extra file extension affordance

Records the TypeScript project option that lets `.featuretype` participate as a mixed-content source file.

```ts
// Source: packages/service/src/languagePlugin.ts
// Source: @volar/typescript/lib/protocol/createProject.js

const typescriptOptions = {
  extraFileExtensions: [
    {
      extension: "featuretype",
      isMixedContent: true,
      scriptKind: ts.ScriptKind.Deferred,
    },
  ],
}

function createLanguageServiceHost() {
  const pluginExtensions = language.plugins
    .flatMap((plugin) => plugin.typescript?.extraFileExtensions ?? [])
    .map((extensionInfo) => `.${extensionInfo.extension}`)

  return {
    readDirectory(dirName, extensions, excludes, includes, depth) {
      return sys.readDirectory(
        dirName,
        [...new Set([...extensions, ...pluginExtensions])],
        excludes,
        includes,
        depth,
      )
    },

    getCompilationSettings() {
      return {
        ...projectHost.getCompilationSettings(),
        allowNonTsExtensions: true,
      }
    },
  }
}
```

The current dormant plugin already uses this shape; the MVP should keep it.

## Associated script affordance

Tracks an advanced Volar relation that may matter only if virtual modules are split across source documents later.

```ts
// Source: @volar/language-core lib/types.d.ts
// Source: @volar/language-core/index.js

interface VirtualCode {
  associatedScriptMappings?: Map<unknown, CodeMapping[]>
}

interface CodegenContext<T = unknown> {
  getAssociatedScript(scriptId: T): SourceScript<T> | undefined
}

function prepareCreateVirtualCode(sourceScript: SourceScript) {
  return {
    getAssociatedScript(id) {
      const relatedSourceScript = language.scripts.get(id, true, true)
      relatedSourceScript.targetIds.add(sourceScript.id)
      sourceScript.associatedIds.add(relatedSourceScript.id)
      return relatedSourceScript
    },
  }
}
```

Same-file fence imports should not need associated scripts; keep this noted for future multi-file `.featuretype` relationships.

## Linked code affordance

Tracks the mirror-position mechanism that can extend references and definitions when generated code has duplicated source relationships.

```ts
// Source: @volar/language-core lib/types.d.ts
// Source: @volar/language-service/lib/features/provideDefinition.js
// Source: @volar/language-service/lib/features/provideReferences.js

interface VirtualCode {
  linkedCodeMappings?: Mapping[]
}

function provideDefinitionWithLinkedCode(document: TextDocument, position: Position) {
  const definitions = plugin.provideDefinition(document, position)

  for (const definition of definitions) {
    const decoded = context.decodeEmbeddedDocumentUri(URI.parse(definition.targetUri))
    const virtualCode = decoded && sourceScript.generated.embeddedCodes.get(decoded[1])
    const linkedCodeMap = virtualCode && context.language.linkedCodeMaps.get(virtualCode)

    for (const linkedPos of getLinkedCodePositions(embeddedDocument, linkedCodeMap, position)) {
      // Volar can recursively inspect linked virtual positions.
    }
  }
}
```

Raw one-to-one TypeScript fences should not need linked code mappings for the MVP.

## Current failure message gap

Records the `.featuretype` semantic failure path for positions that are not inside TypeScript fences.

```ts
// Source: packages/mcp/src/failure.ts

function classifyFailure(file: string, inProjectGraph: boolean) {
  const isFeatureType = file.endsWith(".featuretype")

  if (!inProjectGraph && isFeatureType) {
    return [
      "Reason: file is inside the project root but not part of the TypeScript project graph.",
      ".featuretype files participate via Volar virtual code.",
      "TS/TSX code fences should produce diagnostics and navigation when included.",
    ]
  }

  if (isFeatureType) {
    return [
      "Reason: position may not be inside a ts or tsx code fence.",
      "Semantic queries work inside Markdown fences such as ```ts file=\"./module.ts\".",
    ]
  }
}
```

This message distinguishes prose positions from Markdown TypeScript fence positions.

## Same-file import acceptance shape

Defines the smallest semantic scenario that proves the Volar affordances are wired correctly.

````md
# Same File Import Fixture

```ts file="./root.ts"
import { helper } from "./helper"

export const root = helper("ok")
```

```ts file="./helper.ts"
export const helper = (value: string) => value.toUpperCase()
```
````

The cursor on `helper` in `root.ts` should inspect through the `.featuretype` source file and resolve the definition in the `helper.ts` fence.

## Expected `inspect_symbol` result shape

Shows the source-facing shape the MCP command should return after Volar mapping.

````text
Type / hover:
```typescript
(alias) const helper: (value: string) => string
import helper
```

Definition:
docs/example.featuretype:<line>:<col>

References (2):
docs/example.featuretype:<line>:<col>
docs/example.featuretype:<line>:<col>
````

Generated virtual file names should not be the main user-visible result for same-file fence symbols.

## Node modules bonus path

Keeps package imports secondary and explicitly dependent on ordinary TypeScript project resolution.

```ts
// Source: @volar/typescript/lib/protocol/createProject.js
// Source: @volar/typescript/lib/resolveModuleName.js

// Bonus only:
// import { z } from "zod"

function resolvePackageImport(moduleName: string, containingFenceFile: string) {
  return ts.resolveModuleName(
    moduleName,
    containingFenceFile,
    compilerOptions,
    moduleResolutionHost,
    moduleResolutionCache,
  )
}

// No custom package resolver belongs in the MVP unless TypeScript resolution
// cannot see the project's existing node_modules graph from the virtual file.
```

The MVP should not be blocked on package imports.

## Reference project inventory

Records the Volar reference projects named by the repo's archived research and refreshed for this pass.

Sources: `docs/archive/volar-ecosystem-research.md`, `/tmp/featuretype-volar-research/volar-workspace/README.md`, and `git -C /tmp/featuretype-volar-research/<repo> log -1`.

| Reference | Local path | Commit | Date | Research role |
| --- | --- | --- | --- | --- |
| `volarjs/starter` | `/tmp/featuretype-volar-research/volar-starter` | `14c5ca6` | 2024-09-12 | Minimal canonical Volar language-server and VS Code extension shape. |
| `mdx-js/mdx-analyzer` | `/tmp/featuretype-volar-research/mdx-analyzer` | `660067a` | 2026-03-08 | Markdown-family source parsing, virtual JSX/Markdown code, MDX service plugin, and TypeScript plugin. |
| `vuejs/language-tools` | `/tmp/featuretype-volar-research/vue-language-tools` | `818226a` | 2026-05-14 | Mature production Volar downstream with language core, service, server, TypeScript plugin, and `tsc` integration. |
| `withastro/language-tools` | `/tmp/featuretype-volar-research/astro-language-tools` | `b4bcb4f` | 2025-11-17 | Production non-Vue mixed-language implementation; archived in favor of the Astro monorepo. |
| `volarjs/services` | `/tmp/featuretype-volar-research/volar-services` | `ce25205` | 2026-05-10 | Service plugin implementations, including TypeScript and Markdown service behavior. |
| `volarjs/workspace` | `/tmp/featuretype-volar-research/volar-workspace` | `81d8c43` | 2024-04-29 | Maintainer-curated list of adjacent Volar repositories. |
| `sveltejs/language-tools` | `/tmp/featuretype-volar-research/svelte-language-tools` | `1521b92` | 2026-05-12 | Adjacent non-Volar language-server precedent named by local docs for syntax/assets discipline. |

These are reference patterns, not implementation dependencies.

Svelte is intentionally classified as adjacent rather than Volar coverage: current source search found ordinary TypeScript language-service integration, not `@volar/*` package usage.

## Reference project role map

Classifies which project should answer which `.featuretype` design question.

Sources: `docs/archive/volar-ecosystem-research.md` and `docs/archive/featuretype-vscode-mvp.md`.

| Reference | Questions it should answer |
| --- | --- |
| `volarjs/starter` | Fresh custom file type registration; `createTypeScriptProject` composition; extra service scripts for embedded scripts; service plugin embedded URI decoding. |
| `mdx-js/mdx-analyzer` | Markdown-family syntax parsing before Volar virtual code; multiple virtual languages from one authored Markdown-like file; stable virtual files after parser failures; Markdown service coexistence with TypeScript semantics. |
| `withastro/language-tools` | Production mixed-language primary generated TSX script; extra scripts for inline/module scripts; wrapping TypeScript service plugins; project setup that mutates the TypeScript language-service host. |
| `vuejs/language-tools` | Mature package split across language-core, service, server, TypeScript plugin, and `tsc`; virtual-code caching and incremental update; plugin registry embedded-code contribution; fine-grained `CodeInformation` presets. |
| `volarjs/services` | Reusable Volar service plugin shape; Markdown embedded document discovery; current TypeScript service plugin surface. |
| `sveltejs/language-tools` | Adjacent language-server feature toggles; separation of syntax, formatting, CSS, HTML, and TypeScript concerns; grammar and asset practices that should not be mistaken for Volar MVP requirements. |

The `.featuretype` code-fence MVP should primarily copy starter and MDX scale, keep Astro and Vue as boundary checks, and treat Svelte as adjacent syntax/asset discipline rather than a Volar implementation model.

## Starter baseline pattern

Captures the minimal mixed-file pattern closest to the current Featuretype code.

```ts
// Source: /tmp/featuretype-volar-research/volar-starter/packages/language-server/src/languagePlugin.ts

export const html1LanguagePlugin: LanguagePlugin<URI> = {
  getLanguageId(uri) {
    return uri.path.endsWith(".html1") ? "html1" : undefined
  },

  createVirtualCode(_uri, languageId, snapshot) {
    return languageId === "html1"
      ? new Html1VirtualCode(snapshot)
      : undefined
  },

  typescript: {
    extraFileExtensions: [
      { extension: "html1", isMixedContent: true, scriptKind: ts.ScriptKind.Deferred },
    ],

    getServiceScript() {
      return undefined
    },

    getExtraServiceScripts(fileName, root) {
      const scripts: TypeScriptExtraServiceScript[] = []

      for (const code of forEachEmbeddedCode(root)) {
        if (code.languageId === "javascript") {
          scripts.push({
            fileName: `${fileName}.${code.id}.js`,
            code,
            extension: ".js",
            scriptKind: ts.ScriptKind.JS,
          })
        }

        if (code.languageId === "typescript") {
          scripts.push({
            fileName: `${fileName}.${code.id}.ts`,
            code,
            extension: ".ts",
            scriptKind: ts.ScriptKind.TS,
          })
        }
      }

      return scripts
    },
  },
}
```

Featuretype should keep the starter's shape but change `fileName` from synthetic suffixes to import-resolvable same-directory virtual module paths.

## Starter embedded code pattern

Captures the one-to-one source-to-embedded mapping shape used in the starter.

```ts
// Source: /tmp/featuretype-volar-research/volar-starter/packages/language-server/src/languagePlugin.ts

function* getHtml1EmbeddedCodes(snapshot: ts.IScriptSnapshot, htmlDocument: html.HTMLDocument) {
  for (const [index, script] of htmlDocument.roots.filter((root) => root.tag === "script").entries()) {
    const text = snapshot.getText(script.startTagEnd, script.endTagStart)
    const isTs = script.attributes?.lang === "ts"

    yield {
      id: `script_${index}`,
      languageId: isTs ? "typescript" : "javascript",
      snapshot: createSnapshot(text),
      mappings: [
        {
          sourceOffsets: [script.startTagEnd],
          generatedOffsets: [0],
          lengths: [text.length],
          data: {
            completion: true,
            format: true,
            navigation: true,
            semantic: true,
            structure: true,
            verification: true,
          },
        },
      ],
      embeddedCodes: [],
    } satisfies VirtualCode
  }
}
```

This is the closest match for raw `.featuretype` TypeScript fences.

## Starter service plugin pattern

Captures the pattern for structural diagnostics that inspect the source virtual root from an embedded document.

```ts
// Source: /tmp/featuretype-volar-research/volar-starter/packages/language-server/src/index.ts

const servicePlugin = {
  capabilities: {
    diagnosticProvider: {
      interFileDependencies: false,
      workspaceDiagnostics: false,
    },
  },

  create(context: LanguageServiceContext) {
    return {
      provideDiagnostics(document: TextDocument) {
        const decoded = context.decodeEmbeddedDocumentUri(URI.parse(document.uri))
        if (!decoded) {
          return
        }

        const virtualCode = context.language.scripts
          .get(decoded[0])
          ?.generated
          ?.embeddedCodes
          .get(decoded[1])

        if (!(virtualCode instanceof Html1VirtualCode)) {
          return
        }

        return getDomainDiagnosticsFromRootVirtualCode(virtualCode)
      },
    }
  },
}
```

Featuretype structural diagnostics should follow this pattern for malformed fence metadata and prose-only positions.

## MDX parser pattern

Captures the Markdown-family parsing setup used by MDX.

```ts
// Source: /tmp/featuretype-volar-research/mdx-analyzer/packages/language-service/lib/language-plugin.js

export function createMdxLanguagePlugin(
  remarkPlugins,
  virtualCodePlugins,
  checkMdx = false,
  jsxImportSource = "react",
) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMdx)

  if (remarkPlugins) {
    processor.use(remarkPlugins)
  }

  processor.freeze()

  return {
    getLanguageId(fileNameOrUri) {
      return String(fileNameOrUri).endsWith(".mdx") ? "mdx" : undefined
    },

    createVirtualCode(fileNameOrUri, languageId, snapshot) {
      return languageId === "mdx"
        ? new VirtualMdxCode(snapshot, processor, virtualCodePlugins || [], checkMdx, jsxImportSource)
        : undefined
    },
  }
}
```

Featuretype should use a real Markdown parser or syntax tree for fences; ad hoc fence splitting is the drift-prone path.

## MDX dual virtual language pattern

Captures how MDX emits both a semantic JSX view and a markdown view from one source.

```ts
// Source: /tmp/featuretype-volar-research/mdx-analyzer/packages/language-service/lib/virtual-code.js

function getEmbeddedCodes(mdx, ast, virtualCodePlugins, checkMdx, jsxImportSource) {
  const jsMappings: CodeMapping[] = []
  const markdownMapping: CodeMapping = {
    sourceOffsets: [],
    generatedOffsets: [],
    lengths: [],
    data: {
      completion: true,
      format: false,
      navigation: true,
      semantic: true,
      structure: true,
      verification: true,
    },
  }

  const virtualCodes: VirtualCode[] = []

  virtualCodes.unshift(
    {
      id: "jsx",
      languageId: "javascriptreact",
      mappings: jsMappings,
      snapshot: new ScriptSnapshot(esm),
    },
    {
      id: "md",
      languageId: "markdown",
      mappings: [markdownMapping],
      snapshot: new ScriptSnapshot(markdown),
    },
  )

  return virtualCodes
}
```

Featuretype likely needs a markdown/prose structural view plus multiple TS/TSX fence service scripts; MDX confirms this is a normal Volar shape.

## MDX parser failure pattern

Captures the stable fallback virtual-code behavior when parsing fails.

```ts
// Source: /tmp/featuretype-volar-research/mdx-analyzer/packages/language-service/lib/virtual-code.js

class VirtualMdxCode implements VirtualCode {
  id = "mdx"
  languageId = "mdx"
  embeddedCodes: VirtualCode[] = []
  error: VFileMessage | undefined

  constructor(snapshot, processor, virtualCodePlugins, checkMdx, jsxImportSource) {
    try {
      const ast = processor.parse(source)
      this.embeddedCodes = getEmbeddedCodes(source, ast, virtualCodePlugins, checkMdx, jsxImportSource)
      this.error = undefined
    } catch (error) {
      this.error = error
      this.embeddedCodes = [
        {
          id: "jsx",
          languageId: "javascriptreact",
          mappings: [],
          snapshot: new ScriptSnapshot(fallback),
        },
        {
          id: "md",
          languageId: "markdown",
          mappings: [],
          snapshot: new ScriptSnapshot(source),
        },
      ]
    }
  }
}
```

Featuretype should preserve stable virtual code IDs even when a malformed fence prevents full semantic mapping.

## MDX offset provenance pattern

Captures the Markdown-family offset approach that matters for `.featuretype` fenced TypeScript.

```ts
// Source: /tmp/featuretype-volar-research/mdx-analyzer/packages/language-service/lib/language-plugin.js

export function createMdxLanguagePlugin(remarkPlugins, virtualCodePlugins, checkMdx, jsxImportSource) {
  const processor = unified().use(remarkParse).use(remarkMdx)

  if (remarkPlugins) {
    processor.use(remarkPlugins)
  }

  processor.freeze()

  return {
    createVirtualCode(fileNameOrUri, languageId, snapshot) {
      return languageId === "mdx"
        ? new VirtualMdxCode(snapshot, processor, virtualCodePlugins || [], checkMdx, jsxImportSource)
        : undefined
    },
  }
}
```

```ts
// Source: /tmp/featuretype-volar-research/mdx-analyzer/packages/language-service/lib/mdast-utils.js

export function getNodeStartOffset(node) {
  return getPointOffset(node.position.start)
}

export function getNodeEndOffset(node) {
  return getPointOffset(node.position.end)
}

function getPointOffset(point) {
  // The parser owns exact byte/character offset provenance on unist points.
  return point.offset
}
```

```ts
// Source: /tmp/featuretype-volar-research/mdx-analyzer/packages/language-service/lib/virtual-code.js

function addOffset(mapping, source, generated, startOffset, endOffset, includeNewline) {
  if (includeNewline) {
    const LF = 10
    const CR = 13
    const charCode = source.charCodeAt(endOffset)

    if (charCode === LF) {
      endOffset += 1
    } else if (charCode === CR && source.charCodeAt(endOffset + 1) === LF) {
      endOffset += 2
    }
  }

  const length = endOffset - startOffset
  mapping.sourceOffsets.push(startOffset)
  mapping.generatedOffsets.push(generated.length)
  mapping.lengths.push(length)

  return generated + source.slice(startOffset, endOffset)
}
```

MDX strongly favors parser-owned source positions over hand-counted line splitting. Featuretype still needs a parser decision because the only local `markdown-it` evidence found in the lockfile is transitive through `@vscode/vsce`, not a deliberate parser dependency.

## Markdown parser affordance scan

Compares parser surfaces for the exact fence-offset requirement.

```ts
// Source: micromark@4.0.2 readme.md

// micromark is a CommonMark parser implemented as a state machine that emits
// concrete tokens, accounts for every byte, and includes positional info.
```

```ts
// Source: micromark@4.0.2 index.d.ts

export function micromark(value: Value, options?: Options | null | undefined): string
export { compile } from "./lib/compile.js"
export { parse } from "./lib/parse.js"
export { postprocess } from "./lib/postprocess.js"
export { preprocess } from "./lib/preprocess.js"
```

```ts
// Source: micromark@4.0.2 lib/create-tokenizer.js

function enter(type, fields) {
  const token = fields || {}
  token.type = type
  token.start = now()
  context.events.push(["enter", token, context])
  stack.push(token)
  return token
}

function exit(type) {
  const token = stack.pop()
  token.end = now()
  context.events.push(["exit", token, context])
  return token
}
```

```ts
// Source: mdast-util-from-markdown@2.0.3 lib/index.js

const config = {
  enter: {
    codeFenced: opener(codeFlow),
    codeFencedFenceInfo: buffer,
    codeFencedFenceMeta: buffer,
    codeFlowValue: onenterdata,
  },
  exit: {
    codeFenced: closer(onexitcodefenced),
    codeFencedFence: onexitcodefencedfence,
    codeFencedFenceInfo: onexitcodefencedfenceinfo,
    codeFencedFenceMeta: onexitcodefencedfencemeta,
    codeFlowValue: onexitdata,
  },
}
```

```ts
// Source: mdast-util-from-markdown@2.0.3 lib/index.js

function enter(node, token) {
  node.position = {
    start: point(token.start),
    end: undefined,
  }
}

function exit(token) {
  const node = this.stack.pop()
  node.position.end = point(token.end)
}

function point(d) {
  return {
    line: d.line,
    column: d.column,
    offset: d.offset,
  }
}
```

```ts
// Source: mdast-util-from-markdown@2.0.3 lib/index.js

function onexitcodefencedfenceinfo() {
  const data = this.resume()
  const node = this.stack[this.stack.length - 1]
  node.lang = data
}

function onexitcodefencedfencemeta() {
  const data = this.resume()
  const node = this.stack[this.stack.length - 1]
  node.meta = data
}

function onexitcodefenced() {
  const data = this.resume()
  const node = this.stack[this.stack.length - 1]

  // mdast code.value is useful, but it strips surrounding line endings.
  // Featuretype still needs raw body offsets for Volar mappings.
  node.value = data.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "")
}
```

```ts
// Source: remark-parse@11.0.0 lib/index.js

import { fromMarkdown } from "mdast-util-from-markdown"

export default function remarkParse(options) {
  const self = this
  self.parser = parser

  function parser(doc) {
    return fromMarkdown(doc, {
      ...self.data("settings"),
      ...options,
      extensions: self.data("micromarkExtensions") || [],
      mdastExtensions: self.data("fromMarkdownExtensions") || [],
    })
  }
}
```

```ts
// Source: markdown-it@14.1.1 lib/token.mjs

function Token(type, tag, nesting) {
  // Source map info. Format: [line_begin, line_end].
  this.map = null

  // For fence tokens, content contains the code body and info contains the
  // opening-fence info string.
  this.content = ""
  this.info = ""
  this.markup = ""
}
```

```ts
// Source: markdown-it@14.1.1 lib/rules_block/fence.mjs

const token = state.push("fence", "code", 0)
token.info = params
token.content = state.getLines(startLine + 1, nextLine, len, true)
token.markup = markup
token.map = [startLine, state.line]
```

| Parser surface | Fit for `.featuretype` fences |
| --- | --- |
| `micromark` | Best low-level fit. It exposes concrete token events with start/end offsets and lets Featuretype extract fence delimiter, info, meta, and body ranges without reverse-engineering line maps. |
| `mdast-util-from-markdown` | Good high-level Markdown AST fit. It preserves node positions with offsets and has fence token handlers internally, but mdast `code.value` strips surrounding line endings, so raw body offsets still need token-level care. |
| `remark-parse` | Useful when the product needs a unified/remark processor pipeline. It delegates parsing to `mdast-util-from-markdown`, so it is not the smallest parser surface for a fence-only MVP. |
| `markdown-it` | Useful renderer/parser, but token source maps are line ranges and fence content is reconstructed with `getLines`. It would force Featuretype to recover exact offsets with extra custom logic. |

Parser recommendation for the MVP: build the `.featuretype` fence extractor on `micromark` events, and borrow MDX's unist/remark discipline only if later prose/Markdown AST features become product requirements.

## MDX server composition pattern

Captures how MDX composes Markdown, MDX, and TypeScript services.

```ts
// Source: /tmp/featuretype-volar-research/mdx-analyzer/packages/language-server/lib/index.js

return server.initialize(
  parameters,
  createTypeScriptProject(
    typescript,
    diagnosticMessages,
    ({ configFileName }) => ({
      languagePlugins: getLanguagePlugins(configFileName),
    }),
  ),
  [
    createMarkdownServicePlugin({
      getDiagnosticOptions(document, context) {
        return context.env.getConfiguration?.("mdx.validate")
      },
    }),
    createMdxServicePlugin(connection.workspace),
    ...createTypeScriptServicePlugin(typescript, {}),
  ],
)
```

Featuretype can compose a Markdown/prose service without compromising TypeScript fence semantics.

## MDX TypeScript plugin pattern

Captures the optional TS plugin path as a separate product surface.

```ts
// Source: /tmp/featuretype-volar-research/mdx-analyzer/packages/typescript-plugin/lib/index.cjs

const plugin = createLanguageServicePlugin((ts, info) => {
  const commandLine = ts.parseJsonSourceFileConfigFileContent(
    configFile,
    ts.sys,
    info.project.getCurrentDirectory(),
    undefined,
    configFile.fileName,
  )

  const [remarkPlugins, virtualCodePlugins] = resolvePlugins(
    commandLine.raw?.mdx,
    (name) => require(name).default,
  )

  return {
    languagePlugins: [
      createMdxLanguagePlugin(
        remarkPlugins || defaultRemarkPlugins,
        virtualCodePlugins,
        Boolean(commandLine.raw?.mdx?.checkMdx),
        commandLine.options.jsxImportSource,
      ),
    ],
  }
})
```

Featuretype should not start here for the MCP MVP because same-file fence imports depend on `getExtraServiceScripts`.

## Astro primary TSX service pattern

Captures the production pattern where one generated TSX virtual file represents the custom source file to TypeScript.

```ts
// Source: /tmp/featuretype-volar-research/astro-language-tools/packages/language-server/src/core/index.ts

export function getAstroLanguagePlugin(): LanguagePlugin<URI, AstroVirtualCode> {
  return {
    getLanguageId(uri) {
      return uri.path.endsWith(".astro") ? "astro" : undefined
    },

    createVirtualCode(uri, languageId, snapshot) {
      return languageId === "astro"
        ? new AstroVirtualCode(uri.fsPath.replace(/\\/g, "/"), snapshot)
        : undefined
    },

    typescript: {
      extraFileExtensions: [
        { extension: "astro", isMixedContent: true, scriptKind: ts.ScriptKind.Deferred },
      ],

      getServiceScript(astroCode) {
        for (const code of forEachEmbeddedCode(astroCode)) {
          if (code.id === "tsx") {
            return {
              code,
              extension: ".tsx",
              scriptKind: ts.ScriptKind.TSX,
            }
          }
        }
      },
    },
  }
}
```

Featuretype's same-file imports are better modeled as multiple extra service scripts, but Astro is the reference for a primary generated module if the design later needs one.

## Astro extra script pattern

Captures the production pattern for extracted module scripts as extra service scripts.

```ts
// Source: /tmp/featuretype-volar-research/astro-language-tools/packages/language-server/src/core/index.ts

typescript: {
  getExtraServiceScripts(fileName, astroCode) {
    const result: TypeScriptExtraServiceScript[] = []

    for (const code of forEachEmbeddedCode(astroCode)) {
      if (code.id.endsWith(".mjs") || code.id.endsWith(".mts")) {
        const extension = code.id.endsWith(".mjs") ? ".mjs" : ".mts"

        result.push({
          fileName: `${fileName}.${code.id}`,
          code,
          extension,
          scriptKind: extension === ".mjs" ? ts.ScriptKind.JS : ts.ScriptKind.TS,
        })
      }
    }

    return result
  },
}
```

Featuretype can use the same extra-script mechanism but should choose authored import paths as file names.

## Astro nested virtual code pattern

Captures Astro's root-plus-HTML-plus-TSX virtual tree.

```ts
// Source: /tmp/featuretype-volar-research/astro-language-tools/packages/language-server/src/core/index.ts

class AstroVirtualCode implements VirtualCode {
  id = "root"
  languageId = "astro"

  constructor(fileName: string, snapshot: ts.IScriptSnapshot) {
    const tsx = astro2tsx(snapshot.getText(0, snapshot.getLength()), fileName)
    const { htmlDocument, virtualCode: htmlVirtualCode } = parseHTML(snapshot, frontmatterEnd)

    htmlVirtualCode.embeddedCodes = [
      ...extractStylesheets(tsx.ranges.styles),
      ...extractScriptTags(tsx.ranges.scripts),
    ]

    this.embeddedCodes = [
      htmlVirtualCode,
      tsx.virtualCode,
    ]
  }
}
```

Featuretype probably does not need nested virtual code for raw TypeScript fences, but this is the pattern if prose/Markdown later gets its own embedded language service.

## Astro transformed source map pattern

Captures how Astro turns compiler sourcemaps into Volar mappings.

```ts
// Source: /tmp/featuretype-volar-research/astro-language-tools/packages/language-server/src/core/astro2tsx.ts

function getVirtualCodeTSX(input: string, tsx: TSXResult, fileName: string): VirtualCode {
  const sourcedDoc = TextDocument.create("", "astro", 0, input)
  const genDoc = TextDocument.create("", "typescriptreact", 0, tsx.code)
  const mappings: CodeMapping[] = []

  for (const segment of decodedSourceMapSegments) {
    const genOffset = genDoc.offsetAt({ line: genLine, character: segment[0] })
    const sourceOffset = sourcedDoc.offsetAt({ line: segment[2], character: segment[3] })

    mappings.push({
      sourceOffsets: [sourceOffset],
      generatedOffsets: [genOffset],
      lengths: [sharedTextLength],
      data: {
        verification: true,
        completion: true,
        semantic: true,
        navigation: true,
        structure: true,
        format: false,
      },
    })
  }

  return {
    id: "tsx",
    languageId: "typescriptreact",
    snapshot: createSnapshot(tsx.code),
    mappings,
    embeddedCodes: [],
  }
}
```

Featuretype raw fences can avoid this complexity; wrappers or generated imports would require this level of mapping discipline.

## Astro inline script merge pattern

Captures a production pattern for merging many source regions into one virtual script.

```ts
// Source: /tmp/featuretype-volar-research/astro-language-tools/packages/language-server/src/core/parseJS.ts

function mergeJSContexts(inlineScripts: TSXExtractedScript[]): VirtualCode | undefined {
  const codes: Segment<CodeInformation>[] = []

  for (const javascriptContext of inlineScripts) {
    codes.push([
      `${javascriptContext.content};`,
      undefined,
      javascriptContext.position.start,
      {
        verification: true,
        completion: true,
        semantic: true,
        navigation: true,
        structure: true,
        format: false,
      },
    ])
  }

  return {
    id: "inline.mjs",
    languageId: "javascript",
    snapshot: createSnapshot(toString(codes)),
    embeddedCodes: [],
    mappings: buildMappings(codes),
  }
}
```

Featuretype should not merge importable TS fences; each fence needs its own module identity for same-file imports.

## Astro TypeScript service wrapping pattern

Captures how a production downstream wraps TypeScript service plugins narrowly.

```ts
// Source: /tmp/featuretype-volar-research/astro-language-tools/packages/language-server/src/plugins/typescript/index.ts

export const create = (ts: typeof import("typescript"), options?: Options) => {
  const tsServicePlugins = createTypeScriptServices(ts, options)

  return tsServicePlugins.map((plugin) => {
    if (plugin.name !== "typescript-semantic") {
      return plugin
    }

    return {
      ...plugin,
      create(context) {
        const typeScriptPlugin = plugin.create(context)

        return {
          ...typeScriptPlugin,
          async provideDiagnostics(document, token) {
            const diagnostics = await typeScriptPlugin.provideDiagnostics(document, token)
            return enhancedProvideSemanticDiagnostics(diagnostics)
          },
        }
      },
    }
  })
}
```

Featuretype should only wrap TypeScript providers when a precise mapped-result gap is proven.

## Astro project setup pattern

Captures how Astro mutates TypeScript host settings and adds ambient files during project setup.

```ts
// Source: /tmp/featuretype-volar-research/astro-language-tools/packages/language-server/src/nodeServer.ts
// Source: /tmp/featuretype-volar-research/astro-language-tools/packages/language-server/src/core/index.ts

createTypeScriptProject(typescript, diagnosticMessages, ({ env }) => ({
  languagePlugins: getLanguagePlugins(collectionConfig),

  setup({ project }) {
    const { languageServiceHost, configFileName } = project.typescript!
    const astroInstall = getAstroInstallFromWorkspace(configFileName, env.workspaceFolders)

    addAstroTypes(astroInstall, typescript, languageServiceHost)
  },
}))

function addAstroTypes(astroInstall, ts, host) {
  const getScriptFileNames = host.getScriptFileNames.bind(host)
  const getCompilationSettings = host.getCompilationSettings.bind(host)

  host.getScriptFileNames = () => [
    ...getScriptFileNames(),
    ...ambientAstroTypeFiles,
  ]

  host.getCompilationSettings = () => ({
    ...getCompilationSettings(),
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.Preserve,
    resolveJsonModule: true,
    allowJs: true,
    isolatedModules: true,
  })
}
```

Featuretype should not need host mutation for same-file imports, but this is the sanctioned escape hatch for ambient types and compiler options.

## Vue language plugin registry pattern

Captures the mature pattern where multiple domain plugins contribute parsing and virtual code.

```ts
// Source: /tmp/featuretype-volar-research/vue-language-tools/packages/language-core/lib/languagePlugin.ts

export function createVueLanguagePlugin<T>(
  ts: typeof import("typescript"),
  compilerOptions: ts.CompilerOptions,
  vueCompilerOptions: VueCompilerOptions,
  asFileName: (scriptId: T) => string,
): LanguagePlugin<T, VueVirtualCode> {
  const plugins = createPlugins(pluginContext)
  const fileRegistry = getVueFileRegistry(compilerOptions, vueCompilerOptions, plugins)

  return {
    getLanguageId(scriptId) {
      const fileName = asFileName(scriptId)
      return plugins.find((plugin) => plugin.getLanguageId?.(fileName))
        ?.getLanguageId?.(fileName)
    },

    createVirtualCode(scriptId, languageId, snapshot) {
      const fileName = asFileName(scriptId)
      if (!plugins.some((plugin) => plugin.isValidFile?.(fileName, languageId))) {
        return
      }

      const existing = fileRegistry.get(String(scriptId))
      if (existing) {
        existing.update(snapshot)
        return existing
      }

      const code = new VueVirtualCode(fileName, languageId, snapshot, vueCompilerOptions, plugins, ts)
      fileRegistry.set(String(scriptId), code)
      return code
    },

    updateVirtualCode(_scriptId, code, snapshot) {
      code.update(snapshot)
      return code
    },

    disposeVirtualCode(scriptId) {
      fileRegistry.delete(String(scriptId))
    },
  }
}
```

Featuretype does not need this much plugin architecture for the MVP, but `updateVirtualCode` and stable object reuse are important if edits become frequent.

## Vue embedded code registry pattern

Captures how Vue turns plugin results into nested `VirtualCode` objects.

```ts
// Source: /tmp/featuretype-volar-research/vue-language-tools/packages/language-core/lib/virtualCode/embeddedCodes.ts

export function useEmbeddedCodes(plugins, fileName, sfc) {
  return computed(() => {
    const result: VirtualCode[] = []
    const idToCodeMap = new Map<string, VirtualCode>()

    const virtualCodes = plugins
      .flatMap((plugin) => plugin.getEmbeddedCodes?.(fileName, sfc) ?? [])
      .map(({ code, snapshot, mappings }) => {
        const virtualCode: VirtualCode = {
          id: code.id,
          languageId: resolveCommonLanguageId(code.lang),
          linkedCodeMappings: code.linkedCodeMappings,
          snapshot,
          mappings,
          embeddedCodes: [],
        }

        idToCodeMap.set(code.id, virtualCode)
        return [code.parentCodeId, virtualCode] as const
      })

    for (const [parentCodeId, virtualCode] of virtualCodes) {
      const parent = parentCodeId ? idToCodeMap.get(parentCodeId) : undefined
      parent ? parent.embeddedCodes.push(virtualCode) : result.push(virtualCode)
    }

    return result
  })
}
```

Featuretype can keep a simpler one-level fence list, but this is the reference if Markdown/prose regions become nested virtual languages.

## Vue mapping-token pattern

Captures Vue's mature linked/combine mapping token behavior.

```ts
// Source: /tmp/featuretype-volar-research/vue-language-tools/packages/language-core/lib/virtualCode/embeddedCodes.ts

function getMappingsForCode(code: VueEmbeddedCode) {
  const mappings = buildMappings(code.content)
  const newMappings: typeof mappings = []
  const tokenMappings = new Map<symbol, Mapping>()

  for (const mapping of mappings) {
    if (mapping.data.__combineToken !== undefined) {
      const previous = tokenMappings.get(mapping.data.__combineToken)
      if (previous) {
        previous.sourceOffsets.push(...mapping.sourceOffsets)
        previous.generatedOffsets.push(...mapping.generatedOffsets)
        previous.lengths.push(...mapping.lengths)
      } else {
        tokenMappings.set(mapping.data.__combineToken, mapping)
        newMappings.push(mapping)
      }
      continue
    }

    if (mapping.data.__linkedToken !== undefined) {
      const previous = tokenMappings.get(mapping.data.__linkedToken)
      if (previous) {
        code.linkedCodeMappings.push({
          sourceOffsets: [previous.generatedOffsets[0]],
          generatedOffsets: [mapping.generatedOffsets[0]],
          lengths: [Number(mapping.data.__linkedToken.description)],
          data: undefined,
        })
      }
      continue
    }

    newMappings.push(mapping)
  }

  return newMappings
}
```

Featuretype should not need linked or combined mappings for raw fences; document this so we do not add them prematurely.

## Vue code feature preset pattern

Captures the production pattern of named `CodeInformation` presets.

```ts
// Source: /tmp/featuretype-volar-research/vue-language-tools/packages/language-core/lib/codegen/codeFeatures.ts
// Source: /tmp/featuretype-volar-research/vue-language-tools/packages/language-core/lib/plugins/shared.ts

const codeFeatures = {
  all: {
    verification: true,
    completion: true,
    semantic: true,
    navigation: true,
  },

  navigationWithoutRename: {
    navigation: { shouldRename: () => false },
  },

  semanticWithoutHighlight: {
    semantic: { shouldHighlight: () => false },
  },

  doNotReportTs2339AndTs2551: {
    verification: {
      shouldReport: (_source, code) => String(code) !== "2339" && String(code) !== "2551",
    },
  },
}

const allCodeFeatures = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
}
```

Featuretype should define a small local preset for fence code instead of scattering raw feature objects.

## Volar services Markdown provider pattern

Captures the reusable Markdown service behavior relevant to a prose-plus-code-fence source file.

```ts
// Source: /tmp/featuretype-volar-research/volar-services/packages/markdown/index.ts

export function create({
  documentSelector = ["markdown"],
  fileExtensions = ["md", "mkd", "mdwn", "markdown", "workbook"],
  getDiagnosticOptions = async (_document, context) =>
    context.env.getConfiguration?.("markdown.validate"),
} = {}): LanguageServicePlugin {
  return {
    name: "markdown",
    capabilities: {
      codeActionProvider: true,
      completionProvider: { triggerCharacters: [".", "/", "#"] },
      definitionProvider: true,
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
      documentHighlightProvider: true,
      documentLinkProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      fileReferencesProvider: true,
      renameProvider: { prepareProvider: true },
      fileRenameEditsProvider: true,
      selectionRangeProvider: true,
      workspaceSymbolProvider: {},
    },
  }
}
```

This service can help a Markdown-like `.featuretype` source surface, but it does not itself create TypeScript fence modules.

## Volar services embedded markdown discovery pattern

Captures how the Markdown service looks through embedded virtual code for markdown documents.

```ts
// Source: /tmp/featuretype-volar-research/volar-services/packages/markdown/index.ts

async function findMarkdownFilesInWorkspace(folder: URI) {
  const docs: ITextDocument[] = []

  for (const fileUri of markdownCandidateUris) {
    let sourceScript = context.language.scripts.get(fileUri)

    if (!sourceScript && fileContent !== undefined) {
      sourceScript = context.language.scripts.set(fileUri, createSnapshot(fileContent))
      context.language.scripts.delete(fileUri)
    }

    if (sourceScript?.generated) {
      for (const virtualCode of forEachEmbeddedCode(sourceScript.generated.root)) {
        if (matchDocument(documentSelector, virtualCode)) {
          const uri = context.encodeEmbeddedDocumentUri(sourceScript.id, virtualCode.id)
          const doc = context.documents.get(uri, virtualCode.languageId, virtualCode.snapshot)
          docs.push(doc)
        }
      }
    }
  }

  return docs
}
```

If Featuretype creates a markdown/prose embedded code, existing Markdown services can find it through normal Volar embedded-code traversal.

## Vue component-meta checker precedent

Shows how a Volar language plugin can be reused outside the editor to build a domain checker on top of the same TypeScript project.

```ts
// Source: https://github.com/vuejs/language-tools
// Local research clone: /tmp/featuretype-volar-research/vue-language-tools
// Files:
// - packages/component-meta/lib/checker.ts
// - packages/component-meta/README.md

import { createLanguageServiceHost, resolveFileLanguageId } from "@volar/typescript"
import { createLanguage } from "@vue/language-core"
import ts from "typescript"

export function createDomainCheckerShape(getConfigAndFiles, checkerOptions, rootPath) {
  let [{ vueOptions, options, projectReferences }, fileNames] = getConfigAndFiles()
  let fileNamesSet = new Set(fileNames.map((path) => path.replace(/\\/g, "/")))
  let projectVersion = 0

  const projectHost = {
    getCurrentDirectory: () => rootPath,
    getProjectVersion: () => projectVersion.toString(),
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...fileNamesSet],
    getProjectReferences: () => projectReferences,
  }

  const scriptSnapshots = new Map()

  const language = createLanguage(
    [
      createVueLanguagePlugin(ts, projectHost.getCompilationSettings(), vueOptions, (id) => id),
      { getLanguageId: (fileName) => resolveFileLanguageId(fileName) },
    ],
    new FileMap(ts.sys.useCaseSensitiveFileNames),
    (fileName) => {
      if (!scriptSnapshots.has(fileName)) {
        const text = ts.sys.readFile(fileName)
        scriptSnapshots.set(
          fileName,
          text === undefined ? undefined : ts.ScriptSnapshot.fromString(text),
        )
      }

      const snapshot = scriptSnapshots.get(fileName)

      if (snapshot) {
        language.scripts.set(fileName, snapshot)
      } else {
        language.scripts.delete(fileName)
      }
    },
  )

  const { languageServiceHost } = createLanguageServiceHost(
    ts,
    ts.sys,
    language,
    (fileName) => fileName,
    projectHost,
  )

  const tsLs = ts.createLanguageService(languageServiceHost)

  return {
    getProgram: () => tsLs.getProgram(),

    updateFile(fileName, text) {
      scriptSnapshots.set(fileName.replace(/\\/g, "/"), ts.ScriptSnapshot.fromString(text))
      fileNamesSet.add(fileName.replace(/\\/g, "/"))
      projectVersion++
    },

    deleteFile(fileName) {
      fileNamesSet.delete(fileName.replace(/\\/g, "/"))
      projectVersion++
    },
  }
}
```

This is not needed for the `inspect_symbol` MVP, but it is a documented Volar affordance: the same language plugin can power editor LSP, MCP introspection, and future Featuretype-specific semantic extraction without inventing a second TypeScript environment.

## Vue TypeScript-plugin request precedent

Shows how Vue exposes domain-specific symbol metadata through a TypeScript plugin request layered on the same Volar language and TypeScript program.

```ts
// Source: https://github.com/vuejs/language-tools
// Local research clone: /tmp/featuretype-volar-research/vue-language-tools
// File: packages/typescript-plugin/lib/requests/getComponentMeta.ts

import type { Language, SourceScript, VueVirtualCode } from "@vue/language-core"
import type ts from "typescript"
import { getComponentMeta as readComponentMeta } from "vue-component-meta/lib/componentMeta"
import { getComponentType } from "./utils"

export function getComponentMeta(
  tsModule: typeof ts,
  program: ts.Program,
  language: Language,
  getSourceScript: (fileName: string) => SourceScript | undefined,
  sourceFile: ts.SourceFile,
  virtualCode: VueVirtualCode,
  tag: string,
) {
  const checker = program.getTypeChecker()
  const componentType = getComponentType(tsModule, checker, sourceFile, virtualCode, tag)

  if (!componentType) {
    return
  }

  return readComponentMeta(
    tsModule,
    checker,
    tsModule.createPrinter(),
    language,
    getSourceScript,
    componentType.node,
    componentType.type,
    false,
  )
}
```

Featuretype should not add a custom TypeScript-plugin request for the MVP, but this is a future affordance if MCP grows from symbol inspection into Featuretype-specific API extraction.

## Vue language-server evidence precedent

Shows a high-fidelity reference shape for observing TypeScript navigation across a Volar mixed-content language.

```ts
// Source: https://github.com/vuejs/language-tools
// Local research clone: /tmp/featuretype-volar-research/vue-language-tools
// Files:
// - packages/language-server/tests/server.ts
// - packages/language-server/tests/definitions.spec.ts
// - packages/language-server/tests/moduleResolution.spec.ts

import { launchServer } from "@typescript/server-harness"
import { startLanguageServer } from "@volar/test-utils"
import { URI } from "vscode-uri"

export async function createVueNavigationHarness() {
  const tsserver = launchServer("node_modules/typescript/lib/tsserver.js", [
    "--disableAutomaticTypingAcquisition",
    "--globalPlugins",
    "@vue/typescript-plugin",
    "--suppressDiagnosticEvents",
  ])

  const volarServer = startLanguageServer(require.resolve("../index.js"), testWorkspacePath)

  volarServer.connection.onNotification("tsserver/request", ([id, command, args]) => {
    tsserver.message({ seq: nextSeq(), command, arguments: args }).then(
      (response) => volarServer.connection.sendNotification("tsserver/response", [id, response?.body]),
      () => volarServer.connection.sendNotification("tsserver/response", [id, undefined]),
    )
  })

  return {
    async open(uri, languageId, content) {
      if (uri.startsWith("file://")) {
        await tsserver.message({
          seq: nextSeq(),
          type: "request",
          command: "updateOpen",
          arguments: {
            changedFiles: [],
            closedFiles: [],
            openFiles: [{ file: URI.parse(uri).fsPath, fileContent: content }],
          },
        })
      }

      return volarServer.openInMemoryDocument(uri, languageId, content)
    },

    async definition(document, offset) {
      return tsserver.message({
        seq: nextSeq(),
        command: "definition",
        arguments: {
          file: URI.parse(document.uri).fsPath,
          position: offset,
        },
      })
    },
  }
}
```

For Featuretype, this is now an active evidence lane: the language-server tests open `.featuretype` files, request hover/definition/references inside fenced imports, and confirm results map back into the source file rather than leaking encoded embedded URIs.

## Vue module-resolution invalidation precedent

Shows how a reference Volar project proves module-resolution cache invalidation instead of only proving a static happy path.

```ts
// Source: https://github.com/vuejs/language-tools
// Local research clone: /tmp/featuretype-volar-research/vue-language-tools
// File: packages/language-server/tests/moduleResolution.spec.ts

import { expect, test } from "vitest"

test("clears missing module error after a missing import becomes resolvable", async () => {
  const server = await getLanguageServer()
  const document = await openDocument(
    server,
    "/workspace/module-rename-main.vue",
    `
      <script setup lang="ts">
      import Comp from "./module-rename-comp-renamed.vue"
      </script>
    `,
  )

  const diagnosticsBefore = await getSemanticDiagnostics(server, document.uri)
  expect(diagnosticsBefore.some((diagnostic) => diagnostic.code === 2307)).toBe(true)

  renameFile("/workspace/module-rename-comp.vue", "/workspace/module-rename-comp-renamed.vue")

  await expect.poll(async () => {
    const diagnosticsAfter = await getSemanticDiagnostics(server, document.uri)
    return diagnosticsAfter.some((diagnostic) => diagnostic.code === 2307)
  }).toBe(false)
})
```

Featuretype same-file imports create virtual module paths instead of renaming real files, but the same risk exists: the implementation must invalidate TypeScript resolution when a fence `file=` attribute changes, appears, disappears, or collides.

## Astro language-server harness precedent

Shows a compact in-memory LSP test harness for a Volar language server.

```ts
// Source: https://github.com/withastro/language-tools
// Local research clone: /tmp/featuretype-volar-research/astro-language-tools
// File: packages/language-server/test/server.ts

import { createHash } from "node:crypto"
import { startLanguageServer } from "@volar/test-utils"
import { URI } from "vscode-uri"

export async function createAstroHarness() {
  const serverHandle = startLanguageServer(
    path.resolve("./bin/nodeServer.js"),
    fileURLToPath(new URL("./fixture", import.meta.url)),
  )

  await serverHandle.initialize(
    URI.file(fixtureDir).toString(),
    {
      typescript: {
        tsdk: path.join(fixtureDir, "../node_modules/typescript/lib"),
      },
      contentIntellisense: true,
    },
    {
      textDocument: {
        definition: { linkSupport: true },
      },
      workspace: {
        didChangeWatchedFiles: {},
        configuration: true,
      },
    },
  )

  return {
    openFakeDocument(content: string, languageId: string) {
      const hash = createHash("sha256").update(content).digest("base64url")
      const uri = URI.file(`does-not-exist-${hash}.astro`).toString()
      return serverHandle.openInMemoryDocument(uri, languageId, content)
    },
  }
}
```

Featuretype can use this shape for MCP-adjacent language-server evidence without creating fixture files for every fence example.

## Astro script semantics evidence precedent

Shows that reference Volar projects observe semantic participation at the source-document level, including ignored regions and multibyte offset mapping.

```ts
// Source: https://github.com/withastro/language-tools
// Local research clone: /tmp/featuretype-volar-research/astro-language-tools
// Files:
// - packages/language-server/test/typescript/scripts.test.ts
// - packages/language-server/test/typescript/diagnostics.test.ts

import { Position, Range } from "@volar/language-server"
import assert from "node:assert"

export const astroScriptBehaviorChecks = {
  moduleScripts: {
    source: '<script>import * as path from "node:path";path;</script>',
    expectation: "script tags participate in TypeScript module diagnostics",
  },

  ignoredRawScripts: {
    source: '<script is:raw>const hello = "Hello";</script>',
    request: (server, document) => server.handle.sendHoverRequest(document.uri, Position.create(0, 38)),
    expectation: "hover is null because the region opts out of semantic mapping",
  },

  multibyteOffsets: {
    source: "🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀\n<script>doesntExists</script>",
    expectation: Range.create(1, 8, 1, 20),
  },
} as const
```

Featuretype needs equivalent checks for prose regions, fenced TypeScript regions, and multibyte characters before fences because `inspect_symbol` is only trustworthy when source offsets map precisely.

## Volar test-utils affordance

Documents the built-in LSP harness and snapshot printer that can test the actual mapping surface.

```ts
// Source: https://github.com/volarjs/volar.js
// Local research clone: /tmp/featuretype-volar-research/volar-js
// File: packages/test-utils/index.ts

import { defaultMapperFactory, forEachEmbeddedCode } from "@volar/language-core"
import { createProtocolConnection } from "@volar/language-server/node"
import { TextDocument } from "vscode-languageserver-textdocument"

export function startLanguageServer(serverModule: string, cwd?: string | URL) {
  const childProcess = fork(
    serverModule,
    ["--stdio", `--clientProcessId=${process.pid.toString()}`],
    { execArgv: ["--nolazy"], env: process.env, cwd, stdio: "pipe" },
  )

  const connection = createProtocolConnection(childProcess.stdout, childProcess.stdin)

  return {
    connection,

    initialize(rootUri, initializationOptions, capabilities = {}) {
      return connection.sendRequest(InitializeRequest.type, {
        processId: childProcess.pid ?? null,
        rootUri: typeof rootUri === "string" ? rootUri : null,
        workspaceFolders: Array.isArray(rootUri) ? rootUri : null,
        initializationOptions,
        capabilities,
      })
    },

    openInMemoryDocument(uri, languageId, content) {
      const document = TextDocument.create(uri, languageId, nextVersion(uri), content)
      return sendDidOpen(connection, document)
    },

    sendHoverRequest(uri, position) {
      return connection.sendRequest(HoverRequest.type, { textDocument: { uri }, position })
    },

    sendDefinitionRequest(uri, position) {
      return connection.sendRequest(DefinitionRequest.type, { textDocument: { uri }, position })
    },

    sendReferencesRequest(uri, position, context) {
      return connection.sendRequest(ReferencesRequest.type, { textDocument: { uri }, position, context })
    },
  }
}

export function* printSnapshots(sourceScript) {
  if (!sourceScript.generated) {
    return
  }

  for (const virtualCode of forEachEmbeddedCode(sourceScript.generated.root)) {
    yield* printSnapshot(sourceScript, virtualCode)
  }
}

export function* printSnapshot(sourceScript, virtualCode) {
  const map = defaultMapperFactory(virtualCode.mappings)

  for (const generatedOffset of generatedOffsets(virtualCode.snapshot)) {
    for (const [sourceOffset, mapping] of map.toSourceLocation(generatedOffset)) {
      yield {
        generatedOffset,
        sourceOffset,
        mapping,
      }
    }
  }
}
```

This is the best existing harness for proving `.featuretype` maps source positions inside fences to virtual TypeScript and back.

## Volar kit checker affordance

Shows that Volar already provides a checker path for non-editor diagnostics and file events.

```ts
// Source: https://github.com/volarjs/volar.js
// Local research clone: /tmp/featuretype-volar-research/volar-js
// Files:
// - packages/kit/lib/createChecker.ts
// - packages/kit/README.md

import {
  createLanguage,
  createLanguageService,
  createUriMap,
  mergeWorkspaceEdits,
} from "@volar/language-service"
import { createLanguageServiceHost, resolveFileLanguageId } from "@volar/typescript"

export function createTypeScriptCheckerShape(languagePlugins, languageServicePlugins, tsconfig) {
  const env = createServiceEnvironment(() => settings)

  const language = createLanguage(
    [
      ...languagePlugins,
      { getLanguageId: (uri) => resolveFileLanguageId(uri.path) },
    ],
    createUriMap(ts.sys.useCaseSensitiveFileNames),
    (uri, includeFsFiles) => {
      if (!includeFsFiles) {
        return
      }

      const text = ts.sys.readFile(uri.fsPath)
      const snapshot = text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)

      if (snapshot) {
        language.scripts.set(uri, snapshot)
      } else {
        language.scripts.delete(uri)
      }
    },
  )

  const project = {
    typescript: createLanguageServiceHost(
      ts,
      ts.sys,
      language,
      (fileName) => URI.file(fileName),
      projectHost,
    ),
  }

  const languageService = createLanguageService(language, languageServicePlugins, env, project)

  return {
    check(fileName) {
      return languageService.getDiagnostics(URI.file(fileName))
    },

    fileCreated(fileName) {
      emitWatchedFileChange(fileName, FileChangeType.Created)
    },

    fileUpdated(fileName) {
      emitWatchedFileChange(fileName, FileChangeType.Changed)
    },

    fileDeleted(fileName) {
      emitWatchedFileChange(fileName, FileChangeType.Deleted)
    },
  }
}
```

This is not the MCP MVP path, but it is relevant if Featuretype later wants a CLI checker for `.featuretype` docs.

## Volar project inclusion affordance

Shows the built-in language-server project path that handles unsaved root files, watched files, command-line refresh, and extra file extensions.

```ts
// Source: https://github.com/volarjs/volar.js
// Local research clone: /tmp/featuretype-volar-research/volar-js
// File: packages/language-server/lib/project/typescriptProjectLs.ts

export async function createTypeScriptLSShape(ts, tsconfig, server, serviceEnv, workspaceFolder, uriConverter, create) {
  let commandLine
  let projectVersion = 0

  const projectHost = {
    getCurrentDirectory: () => uriConverter.asFileName(workspaceFolder),
    getProjectVersion: () => projectVersion.toString(),
    getScriptFileNames: () => commandLine.fileNames,
    getCompilationSettings: () => commandLine.options,
    getProjectReferences: () => commandLine.projectReferences,
  }

  const { languagePlugins, setup } = await create({ projectHost, sys, uriConverter })

  server.documents.onDidChangeContent(() => projectVersion++)

  serviceEnv.onDidChangeWatchedFiles?.(async ({ changes }) => {
    const createdOrDeleted = changes.some((change) => change.type !== FileChangeType.Changed)
    if (createdOrDeleted) {
      await updateCommandLine()
    }
    projectVersion++
  })

  await updateCommandLine()

  const language = createLanguage(
    [
      { getLanguageId: (uri) => server.documents.get(uri)?.languageId },
      ...languagePlugins,
      { getLanguageId: (uri) => resolveFileLanguageId(uri.path) },
    ],
    createUriMap(sys.useCaseSensitiveFileNames),
    syncScriptSnapshotFromOpenDocumentOrFs,
  )

  return {
    tryAddFile(fileName) {
      if (!commandLine.fileNames.includes(fileName)) {
        commandLine.fileNames.push(fileName)
        projectVersion++
      }
    },
  }

  async function updateCommandLine() {
    commandLine = await parseConfig(
      ts,
      sys,
      uriConverter.asFileName(workspaceFolder),
      tsconfig,
      languagePlugins.map((plugin) => plugin.typescript?.extraFileExtensions ?? []).flat(),
    )
  }
}
```

Featuretype already has its own project-file enumeration in the MCP service path, but this upstream code is the canonical Volar behavior to compare against when `.featuretype` documents are opened unsaved or discovered through `tsconfig` parsing.

## Volar semantic TypeScript bridge affordance

Shows how `volar-service-typescript` turns embedded extra service scripts into TypeScript file names and back into embedded document URIs.

```ts
// Source: https://github.com/volarjs/services
// Local research clone: /tmp/featuretype-volar-research/volar-services
// File: packages/typescript/lib/plugins/semantic.ts

export function createTypeScriptSemanticService(ts) {
  return {
    name: "typescript-semantic",

    capabilities: {
      definitionProvider: true,
      typeDefinitionProvider: true,
      hoverProvider: true,
      implementationProvider: true,
      referencesProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ",", "<"],
        retriggerCharacters: [")"],
      },
      diagnosticProvider: {
        interFileDependencies: true,
        workspaceDiagnostics: false,
      },
    },

    create(context) {
      const { languageServiceHost, uriConverter, getExtraServiceScript } = context.project.typescript

      const ctx = {
        uriToFileName(uri) {
          const virtualScript = getVirtualScriptByUri(uri)
          return virtualScript?.fileName ?? uriConverter.asFileName(uri)
        },

        fileNameToUri(fileName) {
          const extraServiceScript = getExtraServiceScript(fileName)
          if (extraServiceScript) {
            const sourceScript = context.language.scripts.fromVirtualCode(extraServiceScript.code)
            return context.encodeEmbeddedDocumentUri(sourceScript.id, extraServiceScript.code.id)
          }

          return uriConverter.asUri(fileName)
        },
      }

      function getVirtualScriptByUri(uri) {
        const decoded = context.decodeEmbeddedDocumentUri(uri)
        const sourceScript = decoded && context.language.scripts.get(decoded[0])
        const virtualCode = decoded && sourceScript?.generated?.embeddedCodes.get(decoded[1])

        if (virtualCode && sourceScript?.generated?.languagePlugin.typescript) {
          const { getServiceScript, getExtraServiceScripts } =
            sourceScript.generated.languagePlugin.typescript

          const sourceFileName = uriConverter.asFileName(sourceScript.id)

          if (getServiceScript(sourceScript.generated.root)?.code === virtualCode) {
            return { fileName: sourceFileName, code: virtualCode }
          }

          for (const extraScript of getExtraServiceScripts?.(sourceFileName, sourceScript.generated.root) ?? []) {
            if (extraScript.code === virtualCode) {
              return extraScript
            }
          }
        }
      }
    },
  }
}
```

This is the crux for `inspect_symbol`: Featuretype must give each importable fence a stable `extraServiceScript.fileName`, and Volar already handles the URI bridge for hover, definition, type definition, implementation, references, signatures, and diagnostics.

## TypeScript service drift check

Compares the installed `volar-service-typescript@0.0.65` bridge with the refreshed `0.0.71` reference source.

```ts
// Source: node_modules volar-service-typescript@0.0.65
// Source: /tmp/featuretype-volar-research/volar-services packages/typescript@0.0.71

function fileNameToUri(fileName: string) {
  const extraServiceScript = getExtraServiceScript(fileName)

  if (extraServiceScript) {
    const sourceScript = context.language.scripts.fromVirtualCode(extraServiceScript.code)

    // The newer 0.0.71 source preserves this same embedded-URI bridge.
    return context.encodeEmbeddedDocumentUri(sourceScript.id, extraServiceScript.code.id)
  }

  const uri = uriConverter.asUri(fileName)
  const sourceScript = context.language.scripts.get(uri)
  const serviceScript = sourceScript?.generated?.languagePlugin.typescript?.getServiceScript(
    sourceScript.generated.root,
  )

  if (sourceScript && serviceScript) {
    return context.encodeEmbeddedDocumentUri(sourceScript.id, serviceScript.code.id)
  }

  return uri
}
```

The URI bridge needed for same-file fence definitions is stable across the installed and refreshed service sources. Module-resolution invalidation remains an implementation proof target, not an unknown Volar affordance.

## Module-resolution cache invalidation affordance

Shows the exact split between Volar's extra script registry refresh and TypeScript's module-resolution cache clear.

```ts
// Source: @volar/typescript/lib/protocol/createProject.js

function sync() {
  const newProjectVersion = projectHost.getProjectVersion?.()
  const shouldUpdate = newProjectVersion === undefined || newProjectVersion !== lastProjectVersion

  if (!shouldUpdate) {
    return
  }

  lastProjectVersion = newProjectVersion
  extraScriptRegistry.clear()

  for (const fileName of projectHost.getScriptFileNames()) {
    const sourceScript = language.scripts.get(asScriptId(fileName))

    for (const extraServiceScript of sourceScript?.generated?.languagePlugin.typescript
      ?.getExtraServiceScripts?.(fileName, sourceScript.generated.root) ?? []) {
      // Changing file= should change these registered module identities.
      tsFileNamesSet.add(extraServiceScript.fileName)
      extraScriptRegistry.set(extraServiceScript.fileName, extraServiceScript)
    }
  }
}
```

```ts
// Source: @volar/typescript/lib/protocol/createProject.js

const moduleResolutionCache = ts.createModuleResolutionCache(
  languageServiceHost.getCurrentDirectory(),
  languageServiceHost.useCaseSensitiveFileNames?.() ? s => s : s => s.toLowerCase(),
  languageServiceHost.getCompilationSettings(),
)

languageServiceHost.resolveModuleNameLiterals = (moduleLiterals, containingFile, redirectedReference, options, containingSourceFile) => {
  if ("version" in sys && lastSysVersion !== sys.version) {
    lastSysVersion = sys.version

    // The explicit cache clear is tied to sys.version, not directly to
    // projectHost.getProjectVersion.
    moduleResolutionCache.clear()
  }

  return moduleLiterals.map(moduleLiteral => {
    const mode = ts.getModeForUsageLocation(containingSourceFile, moduleLiteral, options)
    return resolveModuleName(moduleLiteral.text, containingFile, options, moduleResolutionCache, redirectedReference, mode)
  })
}
```

Volar clearly refreshes the extra service script registry when the project version changes. It is not yet proven that editing only a fence `file=` specifier clears or bypasses TypeScript's module-resolution cache in the current server path.

## Language-server invalidation levers

Shows the two separate invalidation signals available in the current Volar server path.

```ts
// Source: @volar/language-server/lib/project/typescriptProjectLs.js

let projectVersion = 0

const projectHost = {
  getProjectVersion() {
    return projectVersion.toString()
  },
}

const disposables = [
  server.documents.onDidChangeContent(() => projectVersion++),
  serviceEnv.onDidChangeWatchedFiles?.(async ({ changes }) => {
    const createdOrDeleted = changes.some(change => change.type !== FileChangeType.Changed)

    if (createdOrDeleted) {
      await updateCommandLine()
    }

    projectVersion++
  }),
]
```

```ts
// Source: @volar/typescript/lib/protocol/createSys.js

function createSys(sys, env, getCurrentDirectory, uriConverter) {
  let version = 0

  const fileWatcher = env.onDidChangeWatchedFiles?.(({ changes }) => {
    // This is the version checked by createProject's module-resolution cache.
    version++
  })

  return {
    get version() {
      return version
    },
    async sync() {
      while (promises.size) {
        await Promise.all(promises)
      }

      return version
    },
  }
}
```

```ts
// Source: packages/language-server/src/diagnostics.ts

const notifyWatchedFiles = async (filePaths: string[]) => {
  await refreshOpenedDiskDocuments()

  await connection.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: normalizedPaths.map((filePath) => ({
      uri: URI.file(filePath).toString(),
      type: determineWatchedFileChangeType(filePath, previousKnownWatchedFiles, knownWatchedFiles),
    })),
  })
}
```

Document content changes are enough to make Volar rebuild extra service scripts. Watched-file notifications are the explicit path that increments `sys.version`, which is the observed module-resolution-cache clear trigger. The implementation should treat `file=` changes as a cache-sensitive edit until a target harness proves document-change-only invalidation is sufficient.

## Reference project decision ledger

Translates the reference project patterns into `.featuretype` MVP decisions.

| Design area | Reference | MVP direction |
| --- | --- | --- |
| Parser | `mdx-analyzer` | Use syntax-tree-backed Markdown/fence parsing, not line splitting. |
| Virtual file shape | `volarjs/starter` | Use one root `VirtualCode` plus embedded raw TS/TSX fence `VirtualCode` objects. |
| Same-file imports | `volarjs/starter` plus `@volar/typescript` project host | Register each importable fence through `getExtraServiceScripts` with an import-resolvable `fileName`. |
| Primary service script | `withastro/language-tools` | Do not use one primary generated TSX service script for the MVP. |
| Merged scripts | `withastro/language-tools` | Do not merge importable fences; merging destroys module identity. |
| Code feature presets | `vuejs/language-tools` | Define named mapping presets for fence code and metadata-only regions. |
| Incremental update | `vuejs/language-tools` | Prefer `updateVirtualCode` once basic behavior is correct; recreation is acceptable during the first evidence pass. |
| Markdown service | `volarjs/services` Markdown plugin | Treat prose support as optional; it is not the TypeScript fence mechanism. |
| TypeScript plugin | `vuejs/language-tools` plus `mdx-analyzer` | Keep tsserver plugin support as a separate future surface; it is not required for MCP `inspect_symbol`. |
| Domain checker | Vue component-meta plus `@volar/kit createChecker` | Keep CLI/domain extraction as a future affordance; do not create it for the MCP `inspect_symbol` MVP. |
| LSP evidence harness | Vue/Astro language-server tests plus `@volar/test-utils` | Featuretype now opens `.featuretype` documents through `@volar/test-utils` and observes hover, definition, references, diagnostics, document symbols, package imports, and file-identity refresh behavior at fenced source positions. |
| Module-resolution invalidation | Vue `moduleResolution.spec.ts` | Treat `file=` changes as TypeScript project version and module-resolution events. |
| Semantic URI bridge | `volar-service-typescript` `semantic.ts` | Lean on extra service script `fileName` to embedded URI bridging instead of custom MCP symbol routing. |

This ledger should be updated as more reference files are read.

## Upstream starter precedent

Records the closest Volar starter pattern for mixed files with embedded TypeScript.

```ts
// Source: https://github.com/volarjs/starter
// Local research clone: /tmp/featuretype-volar-research/volar-starter
// File: packages/language-server/src/languagePlugin.ts

const html1LanguagePlugin: LanguagePlugin<URI> = {
  getLanguageId(uri) {
    return uri.path.endsWith(".html1") ? "html1" : undefined
  },

  createVirtualCode(uri, languageId, snapshot) {
    return languageId === "html1"
      ? new Html1VirtualCode(snapshot)
      : undefined
  },

  typescript: {
    extraFileExtensions: [
      {
        extension: "html1",
        isMixedContent: true,
        scriptKind: ts.ScriptKind.Deferred,
      },
    ],

    getServiceScript() {
      return undefined
    },

    getExtraServiceScripts(fileName, root) {
      return forEachEmbeddedTypeScriptCode(root).map((code) => ({
        fileName: `${fileName}.${code.id}.ts`,
        code,
        extension: ".ts",
        scriptKind: ts.ScriptKind.TS,
      }))
    },
  },
}
```

The starter confirms the broad Volar affordance; Featuretype needs different virtual file naming for importable same-file fences.

## MDX precedent

Records the Markdown-family precedent without adopting its single generated module strategy.

```ts
// Source: https://github.com/mdx-js/mdx-analyzer
// Local research clone: /tmp/featuretype-volar-research/mdx-analyzer
// File: packages/language-service/lib/language-plugin.js

function createMdxLanguagePlugin(config) {
  return {
    getLanguageId(uri) {
      return uri.path.endsWith(".mdx") ? "mdx" : undefined
    },

    createVirtualCode(uri, languageId, snapshot) {
      return languageId === "mdx"
        ? new VirtualMdxCode(uri, snapshot, config)
        : undefined
    },

    typescript: {
      extraFileExtensions: [
        {
          extension: "mdx",
          isMixedContent: true,
          scriptKind: ts.ScriptKind.Deferred,
        },
      ],

      getServiceScript(root) {
        return {
          code: root.embeddedCodes[0],
          extension: ".jsx",
          scriptKind: ts.ScriptKind.JSX,
        }
      },
    },
  }
}
```

MDX proves Markdown parsing plus mapped virtual code is normal Volar territory; Featuretype's same-file imports point toward multiple extra service scripts instead of one generated JSX service script.

## Version surface

Records the Volar packages currently pinned by this repo and the upstream drift checked during research.

Sources: `package.json`, `packages/service/package.json`, `packages/language-server/package.json`, `packages/mcp/package.json`, and `npm view` on 2026-05-14.

| Package | Current repo version | Latest observed | Repository | Drift note |
| --- | --- | --- | --- | --- |
| `@volar/language-core` | `2.4.28` | `2.4.28` | `https://github.com/volarjs/volar.js` | Current; latest package modified 2026-01-31. |
| `@volar/language-service` | `2.4.28` | `2.4.28` | `https://github.com/volarjs/volar.js` | Current with the rest of the core Volar 2.4.28 line. |
| `@volar/language-server` | `2.4.28` | `2.4.28` | `https://github.com/volarjs/volar.js` | Current with the rest of the core Volar 2.4.28 line. |
| `@volar/typescript` | `2.4.28` | `2.4.28` | `https://github.com/volarjs/volar.js` | Current; latest package modified 2026-01-31. |
| `@volar/kit` | `2.4.28` | `2.4.28` | `https://github.com/volarjs/volar.js` | Current; secondary to the MCP path. |
| `@volar/test-utils` | `2.4.28` | `2.4.28` | `https://github.com/volarjs/volar.js` | Current; useful for later evidence. |
| `volar-service-typescript` | `0.0.65` | `0.0.71` | `https://github.com/volarjs/services` | Drift exists; latest package modified 2026-05-09. |
| `typescript` | `5.9.3` | Not audited here | `https://github.com/microsoft/TypeScript` | Host compiler version for Volar project behavior. |

The core Volar packages are current at `2.4.28`; `volar-service-typescript` has upstream drift and should be checked before implementation changes that depend on service behavior.

## Volar package surface

Lists the local Volar packages and the research role each package plays for the MVP.

Sources: root/package manifests and `node_modules/.pnpm` package declarations.

| Package | MVP relevance | Research role | Related sections |
| --- | --- | --- | --- |
| `@volar/source-map` | Direct | Low-level source/generated offset translation. | Source map affordance. |
| `@volar/language-core` | Central | `LanguagePlugin`, `VirtualCode`, `CodeInformation`, and `SourceScript` graph. | Root virtual code; fence virtual code; mapping gates; language core affordance matrix. |
| `@volar/language-service` | Central | LSP feature workers, embedded URI mapping, and service plugin capability model. | Source-to-virtual flow; virtual-to-source flow; language service affordance matrix. |
| `@volar/typescript` | Central | TypeScript project host, extra service scripts, module resolution, TypeScript plugin/`tsc` utilities. | Extra service script affordance; TypeScript host registration; same-file import resolution; TypeScript proxy matrix. |
| `volar-service-typescript` | Central | Actual TypeScript LSP providers used by `inspect_symbol`. | TypeScript service plugin affordance. |
| `@volar/language-server` | Direct | Server lifecycle, `createTypeScriptProject`, documents, watcher, and file system. | Language server affordance matrix. |
| `@volar/test-utils` | Verification | Language server client for hover, definition, references, symbols, and diagnostics. | Test utility affordance. |
| `@volar/kit` | Secondary verification | Headless checker/formatter APIs. | Kit checker affordance. |
| `@volar/vscode` | Scoped out for MCP | VS Code client helpers and Labs integration. | VS Code extension affordance. |

The MCP MVP is language-server-first; TypeScript plugin, VS Code, and checker APIs are documented so they are not rediscovered or misused later.

## Source map affordance

Records the primitive mapping object that every higher-level Volar feature depends on.

```ts
// Source: @volar/source-map/lib/sourceMap.d.ts
// Source: @volar/source-map/lib/translateOffset.d.ts

interface Mapping<Data = unknown> {
  sourceOffsets: number[]
  generatedOffsets: number[]
  lengths: number[]

  // Optional when generated text length differs from source text length.
  generatedLengths?: number[]

  data: Data
}

class SourceMap<Data = unknown> {
  constructor(readonly mappings: Mapping<Data>[])

  toSourceRange(
    generatedStart: number,
    generatedEnd: number,
    fallbackToAnyMatch: boolean,
    filter?: (data: Data) => boolean,
  ): Generator<[mappedStart: number, mappedEnd: number, startMapping: Mapping<Data>, endMapping: Mapping<Data>]>

  toGeneratedRange(
    sourceStart: number,
    sourceEnd: number,
    fallbackToAnyMatch: boolean,
    filter?: (data: Data) => boolean,
  ): Generator<[mappedStart: number, mappedEnd: number, startMapping: Mapping<Data>, endMapping: Mapping<Data>]>

  toSourceLocation(
    generatedOffset: number,
    filter?: (data: Data) => boolean,
  ): Generator<readonly [number, Mapping<Data>]>

  toGeneratedLocation(
    sourceOffset: number,
    filter?: (data: Data) => boolean,
  ): Generator<readonly [number, Mapping<Data>]>
}

function translateOffset(
  start: number,
  fromOffsets: number[],
  toOffsets: number[],
  fromLengths: number[],
  toLengths?: number[],
  preferEnd?: boolean,
): number | undefined
```

For raw code fences, mappings can be one-to-one; transformed or wrapped code requires `generatedLengths` discipline.

## Language core affordance matrix

Tracks the core Volar object model that the `.featuretype` fence implementation must fit.

Sources: `@volar/language-core/index.d.ts`, `@volar/language-core/lib/types.d.ts`, and `@volar/language-core/index.js`.

| Affordance | Signature or fields | Behavior | MVP use |
| --- | --- | --- | --- |
| `createLanguage` | `createLanguage(plugins, scriptRegistry, sync, onAssociationDirty)` | Creates the `SourceScript` registry, virtual-code ownership graph, maps, and linked maps. | Provided through `createTypeScriptProject`; do not instantiate separately for MCP. |
| `forEachEmbeddedCode` | `forEachEmbeddedCode(virtualCode): Generator<VirtualCode>` | Walks root and nested embedded virtual code. | TypeScript project host discovers all fence virtual codes. |
| `SourceScript` | `id`, `languageId`, `snapshot`, `targetIds`, `associatedIds`, `associatedOnly`, `generated.root`, `generated.languagePlugin`, `generated.embeddedCodes`. | Links an authored source script to generated virtual code. | `.featuretype` source owns all fence virtual modules. |
| `VirtualCode` | `id`, `languageId`, `snapshot`, `mappings`, `associatedScriptMappings?`, `embeddedCodes?`, `linkedCodeMappings?`. | Represents root or embedded code with source maps and optional relationships. | Root `.featuretype` plus one embedded TS/TSX virtual code per importable fence. |
| `CodegenContext` | `getAssociatedScript(scriptId)` | Registers related source scripts and dirty propagation. | Not needed for same-file fence imports. |
| `FileMap` | From `@volar/language-core/lib/utils`. | Case-aware file map used by TypeScript host registries. | Extra service script file names must be stable under the project file-system case rules. |

The required implementation target is a normal Volar `LanguagePlugin`; custom state outside this graph should be treated as suspicious until proven necessary.

## Code information affordance matrix

Expands every `CodeInformation` flag into the LSP features it gates.

Sources: `@volar/language-core/lib/types.d.ts` and `@volar/language-core/lib/editor.js`.

| Flag | Gates | MVP role | Optional callbacks |
| --- | --- | --- | --- |
| `semantic` | Hover, inlay hints, code lens, moniker, inline value, semantic tokens. | Required for `inspect_symbol` hover. | `semantic.shouldHighlight`. |
| `navigation` | Definition, type definition, references, implementation, document highlights, rename, call hierarchy, type hierarchy. | Required for `inspect_symbol` definition, type definition, implementation, and references. | `navigation.shouldHighlight`, `navigation.shouldRename`, `navigation.resolveRenameNewName`, `navigation.resolveRenameEditText`. |
| `completion` | Completion, auto insert, signature help. | Required because `inspect_symbol` includes signature help. | `completion.isAdditional`, `completion.onlyImport`. |
| `verification` | Diagnostics and code actions. | Required for real type safety, even though `inspect_symbol` is the first MCP command. | `verification.shouldReport(source, code)`. |
| `structure` | Document symbols, folding ranges, selection ranges, linked editing, color, document links. | Useful for query fallback and future MCP navigation. | None captured in this pass. |
| `format` | Formatting. | Not required for `inspect_symbol`; safe to preserve if mappings are exact. | None captured in this pass. |

For the MVP, a TS fence mapping that lacks `semantic`, `navigation`, `completion`, or `verification` is incomplete.

## Language service affordance matrix

Lists every Volar language-service feature route and its current relevance.

Sources: `@volar/language-service/lib/languageService.d.ts` and `@volar/language-service/lib/features/*`.

| Relevance | Routes |
| --- | --- |
| `inspect_symbol` critical | `getHover`, `getSignatureHelp`, `getDefinition`, `getTypeDefinition`, `getImplementations`, `getReferences`. |
| Type-safety critical | `getDiagnostics`, `getWorkspaceDiagnostics`, `getCodeActions`, `resolveCodeAction`. |
| Source structure | `getDocumentSymbols`, `getFoldingRanges`, `getSelectionRanges`, `getDocumentLinks`, `getDocumentHighlights`. |
| Editing later | `getCompletionItems`, `resolveCompletionItem`, `getRenameRange`, `getRenameEdits`, `getFileRenameEdits`, `getDocumentFormattingEdits`, `getAutoInsertSnippet`, `getDocumentDropEdits`. |
| Visual later | `getSemanticTokens`, `getInlayHints`, `resolveInlayHint`, `getCodeLenses`, `resolveCodeLens`, `getDocumentColors`, `getColorPresentations`, `getInlineValue`, `getMoniker`. |
| Graph later | `getWorkspaceSymbols`, `resolveWorkspaceSymbol`, `getFileReferences`, `getCallHierarchyItems`, `getCallHierarchyIncomingCalls`, `getCallHierarchyOutgoingCalls`, `getTypeHierarchyItems`, `getTypeHierarchySupertypes`, `getTypeHierarchySubtypes`. |

`inspect_symbol` uses a narrow subset, but the mapping data should not accidentally disable adjacent language-service features that exercise the same source maps.

## Language service plugin affordance

Documents the extension point for custom non-TypeScript behavior.

```ts
// Source: @volar/language-service/lib/types.d.ts

interface LanguageServicePlugin<P = any> {
  name?: string

  capabilities: {
    hoverProvider?: boolean
    documentSymbolProvider?: boolean
    referencesProvider?: boolean
    implementationProvider?: boolean
    definitionProvider?: boolean
    typeDefinitionProvider?: boolean
    signatureHelpProvider?: { triggerCharacters?: string[]; retriggerCharacters?: string[] }
    completionProvider?: { resolveProvider?: boolean; triggerCharacters?: string[] }
    diagnosticProvider?: { interFileDependencies: boolean; workspaceDiagnostics: boolean }
    codeActionProvider?: { codeActionKinds?: string[]; resolveProvider?: boolean }
    workspaceSymbolProvider?: { resolveProvider?: boolean }
    fileReferencesProvider?: boolean
    renameProvider?: { prepareProvider?: boolean }
    fileRenameEditsProvider?: boolean
    semanticTokensProvider?: { legend: SemanticTokensLegend }
    inlayHintProvider?: { resolveProvider?: boolean }
    codeLensProvider?: { resolveProvider?: boolean }
    documentFormattingProvider?: boolean
    documentLinkProvider?: { resolveProvider?: boolean }
    foldingRangeProvider?: boolean
    selectionRangeProvider?: boolean
    linkedEditingRangeProvider?: boolean
    colorProvider?: boolean
    inlineValueProvider?: boolean
    monikerProvider?: boolean
    callHierarchyProvider?: boolean
    typeHierarchyProvider?: boolean
    documentDropEditsProvider?: boolean
    autoInsertionProvider?: { triggerCharacters: string[]; configurationSections?: string[] }
  }

  create(context: LanguageServiceContext): LanguageServicePluginInstance<P>
}
```

The MVP should not create a custom semantic TypeScript provider; `createFeatureTypeServicePlugin` remains useful for structural `.featuretype` diagnostics and source-level affordances.

## Language service context affordance

Records the context APIs that matter for embedded document handling and custom structural plugins.

```ts
// Source: @volar/language-service/lib/types.d.ts
// Source: @volar/language-service/lib/languageService.d.ts

interface LanguageServiceContext {
  language: Language<URI>
  project: ProjectContext
  getLanguageService(): LanguageService
  env: LanguageServiceEnvironment

  documents: {
    get(uri: URI, languageId: string, snapshot: ts.IScriptSnapshot): TextDocument
  }

  decodeEmbeddedDocumentUri(maybeEmbeddedUri: URI): [
    documentUri: URI,
    embeddedCodeId: string,
  ] | undefined

  encodeEmbeddedDocumentUri(uri: URI, embeddedCodeId: string): URI

  disabledEmbeddedDocumentUris: UriMap<boolean>
  disabledServicePlugins: WeakSet<LanguageServicePluginInstance>
}

const embeddedContentScheme = "volar-embedded-content"
```

`decodeEmbeddedDocumentUri` and `encodeEmbeddedDocumentUri` are the source of truth for crossing between `.featuretype` URIs and fence virtual documents.

## Feature worker affordance

Documents the worker abstraction that runs LSP features over embedded virtual code.

Source: `@volar/language-service/lib/utils/featureWorkers.js`.

| Worker/API | Behavior | MVP use |
| --- | --- | --- |
| `languageFeatureWorker` | Loads source script for a real URI; walks embedded virtual documents; maps source positions to generated positions; calls service plugin providers on embedded documents; maps provider results back to source ranges; combines results when requested. | All `inspect_symbol` calls from `.featuretype` source positions. |
| `documentFeatureWorker` | Runs whole-document features over embedded documents and validates mapping data before calling providers. | Diagnostics and document symbols later; not the first position command. |
| `forEachEmbeddedDocument` | Walks nested embedded codes; creates `volar-embedded-content` URIs; creates `TextDocument` objects for source and embedded snapshots; retrieves source maps. | Makes every TS fence discoverable from one `.featuretype` source. |
| `getGeneratedPositions` | Maps source `Position` to generated `Position` with a `CodeInformation` filter. | Cursor inside fence maps to TS provider cursor. |
| `getSourceRange` | Maps generated `Range` to source `Range` with a `CodeInformation` filter. | Definitions, references, and hover ranges map back to `.featuretype`. |

The MVP should ride these workers; bypassing them would be a sign the Volar integration is shaped wrong.

## TypeScript service capability matrix

Documents exactly what `volar-service-typescript` contributes to the Volar language service.

Sources: `volar-service-typescript/index.js`, `volar-service-typescript/lib/plugins/semantic.js`, and `volar-service-typescript/lib/plugins/syntactic.d.ts`.

| Area | Affordances |
| --- | --- |
| Created plugins | `typescript-semantic`, `typescript-syntactic`, `typescript-doc-comment-template`, `typescript-directive-comment`. |
| Semantic capabilities | Completion, rename, file rename edits, code actions, inlay hints, call hierarchy, definition, type definition, diagnostics, hover, implementation, references, file references, document highlights, semantic tokens, workspace symbols, signature help. |
| `inspect_symbol` provider methods | Hover uses `languageService.getQuickInfoAtPosition`; signature help uses `getSignatureHelpItems`; definition uses `getDefinitionAndBoundSpan`; type definition uses `getTypeDefinitionAtPosition`; implementation uses `getImplementationAtPosition`; references use `findReferences`. |
| Diagnostic provider methods | Syntactic diagnostics use `program.getSyntacticDiagnostics`; semantic diagnostics use `program.getSemanticDiagnostics`; declaration diagnostics use `program.getDeclarationDiagnostics` when declarations are emitted. |

This is the actual TypeScript semantic engine for the MVP.

## TypeScript document conversion affordance

Records how `volar-service-typescript` maps extra service scripts to embedded document URIs.

```ts
// Source: volar-service-typescript/lib/plugins/semantic.js

function uriToFileName(uri: URI) {
  const virtualScript = getVirtualScriptByUri(uri)
  if (virtualScript) {
    return virtualScript.fileName
  }

  return uriConverter.asFileName(uri)
}

function fileNameToUri(fileName: string) {
  const extraServiceScript = getExtraServiceScript(fileName)
  if (extraServiceScript) {
    const sourceScript = context.language.scripts.fromVirtualCode(extraServiceScript.code)
    return context.encodeEmbeddedDocumentUri(sourceScript.id, extraServiceScript.code.id)
  }

  return uriConverter.asUri(fileName)
}

function getVirtualScriptByUri(uri: URI) {
  const decoded = context.decodeEmbeddedDocumentUri(uri)
  const sourceScript = decoded && context.language.scripts.get(decoded[0])
  const virtualCode = decoded && sourceScript?.generated?.embeddedCodes.get(decoded[1])

  for (const extraScript of getExtraServiceScripts?.(sourceFileName, sourceScript.generated.root) ?? []) {
    if (extraScript.code === virtualCode) {
      return extraScript
    }
  }
}
```

This is the source-facing result path for same-file imports: TypeScript sees `/repo/docs/helper.ts`; Volar can convert that back to an embedded URI and then to `.featuretype`.

## TypeScript proxy affordance matrix

Tracks the TypeScript proxy layer that maps TypeScript results through Volar source maps.

Sources: `@volar/typescript/lib/node/proxyLanguageService.js` and `@volar/typescript/lib/node/transform.js`.

| Mapping direction | Feature | Volar path |
| --- | --- | --- |
| Input | Hover | `getQuickInfoAtPosition` maps with `toGeneratedOffsets(..., isHoverEnabled)`. |
| Input | Definition | `getDefinitionAndBoundSpan` and `getDefinitionAtPosition` map with `linkedCodeFeatureWorker(..., isDefinitionEnabled)`. |
| Input | Type definition | `getTypeDefinitionAtPosition` maps with `linkedCodeFeatureWorker(..., isTypeDefinitionEnabled)`. |
| Input | Implementation | `getImplementationAtPosition` maps with `linkedCodeFeatureWorker(..., isImplementationEnabled)`. |
| Input | References | `findReferences` and `getReferencesAtPosition` map with `linkedCodeFeatureWorker(..., isReferencesEnabled)`. |
| Input | Inlay hints | `provideInlayHints` maps with `findOverlapCodeRange(..., isSemanticTokensEnabled)`. |
| Output | Hover | `transformTextSpan(..., isHoverEnabled)`. |
| Output | Definition/type definition/implementation/references | `transformDocumentSpan(...)` with the matching feature gate. |
| Output | Diagnostics | `transformDiagnostic(..., shouldReportDiagnostics)`. |
| Output | Edits | `transformFileTextChanges(...)` with a feature-specific filter. |
| Offset boundary | Service script offsets | The default path adds `sourceScript.snapshot.getLength()` to service-script offsets unless `TypeScriptServiceScript.preventLeadingOffset` is used. Verify generated positions through Volar APIs; do not guess around offsets. |

The proxy confirms why CodeInformation flags are load-bearing for every `inspect_symbol` subsection.

## TypeScript project host affordance matrix

Tracks the host hooks that make virtual fence modules visible to TypeScript.

Source: `@volar/typescript/lib/protocol/createProject.js`.

| Host hook | Behavior | MVP use |
| --- | --- | --- |
| `readDirectory` | Adds language plugin `extraFileExtensions` to TypeScript directory reads. | Lets `.featuretype` source files enter the project file list. |
| `getCompilationSettings` | Enables `allowNonTsExtensions` when plugin extensions exist. | Allows `.featuretype` source scripts in the TypeScript project host. |
| `getScriptFileNames` | Returns real TS files plus extra service script file names. | Exposes each importable fence as a TypeScript script. |
| `getScriptSnapshot` | Returns extra service script snapshots from memory. | TypeScript reads fence code without any generated file on disk. |
| `getScriptKind` | Uses extra service script `scriptKind` for virtual files. | Distinguishes TS and TSX fences. |
| `getScriptVersion` | Versions extra service scripts by snapshot identity. | Updates TypeScript project when fence content changes. |
| `fileExists` | Returns true when `getScriptVersion(fileName)` is not empty. | Same-file imports resolve to registered fence file names. |
| `directoryExists` | Consults virtual TS file directory registry before `sys.directoryExists`. | Virtual sibling directories can resolve without generated folders. |
| `resolveModuleNameLiterals` | Routes TypeScript module resolution through the Volar-aware module-resolution host. | Same-file imports should use standard TypeScript resolution. |

The same-file import design should be expressed as stable extra service script file names, not as a custom import resolver.

## TypeScript plugin and tsc affordances

Documents Volar affordances that are intentionally outside the first MCP implementation lane.

Sources: `@volar/typescript/lib/quickstart/createLanguageServicePlugin.d.ts`, `@volar/typescript/lib/quickstart/runTsc.d.ts`, `@volar/typescript/lib/node/proxyCreateProgram.js`, and `@volar/typescript/lib/node/decorateLanguageServiceHost.js`.

| Affordance | Role | Limitation or MVP status |
| --- | --- | --- |
| `createLanguageServicePlugin` | Creates a tsserver plugin from Volar language plugins. | Not the MCP lane; `getExtraServiceScripts` is not available in TS plugin mode. |
| `createAsyncLanguageServicePlugin` | Async tsserver plugin creation. | Same TS plugin constraint; not the MCP lane. |
| `runTsc` | Patches `tsc` to support extra extensions and Volar language plugins. | Possible future CLI/check lane. |
| `proxyCreateProgram` | Program-level Volar integration for TypeScript. | Avoid for same-file fence imports; source warns that `getExtraServiceScripts()` is not available in this use case. |
| `decorateLanguageServiceHost` | Host decoration in TS plugin mode. | Avoid for same-file fence imports; source warns that `getExtraServiceScripts()` is not available in TS plugin mode. |

This is a major architectural boundary: same-file importable fences currently point to the Volar language-server project path, not TS plugin mode.

## Language server affordance matrix

Documents the Volar server affordances already used by this repo.

Sources: `@volar/language-server/node.d.ts`, `@volar/language-server/lib/server.d.ts`, and `packages/language-server/src/server.ts`.

| Server affordance | Role | Current use or MVP use |
| --- | --- | --- |
| `createConnection` | Constructs the LSP connection. | Used in `packages/language-server/src/server.ts`. |
| `createServer` | Wraps the connection with Volar server features. | Provides initialize/initialized/shutdown, documents, workspace folders, file watcher, file system, configurations, and language-feature refresh. |
| `createTypeScriptProject` | Creates the TypeScript-aware Volar project. | Required for fence module imports and TypeScript semantics. |
| `loadTsdkByPath` | Loads workspace TypeScript and localized diagnostics. | Used through the server initialization `typescript.tsdk` option. |
| `fileWatcher` | Watches workspace files. | Current patterns include `**/*.{featuretype,ts,tsx,js,jsx,json}`; `.featuretype` changes should refresh virtual fence modules. |
| File-system installation | Installs custom file-system providers by scheme. | Not needed for disk-backed `.featuretype` files. |

The MCP server uses this language server as a programmatic client, so server affordances still matter even without VS Code.

## Test utility affordance

Documents the Volar testing API that can exercise the actual language server shape.

Source: `@volar/test-utils/index.d.ts`.

| Utility | Inputs or returns | MVP relevance |
| --- | --- | --- |
| `startLanguageServer` | Inputs: `serverModule`, `cwd`. Returns helpers for initialize, shutdown, opening text/untitled/in-memory documents, updating documents, sending watched-file changes, and sending hover/definition/type-definition/references/signature-help/diagnostic/document-symbol/semantic-token/code-action/completion requests. | Can verify source-position `inspect_symbol` prerequisites without inventing an alternate harness. |
| `printSnapshots` | Prints source and embedded virtual snapshots. | Useful for debugging fence virtual code and mappings. |

This is a verification affordance, not an implementation dependency.

## Kit checker affordance

Documents the headless checker path for diagnostics and source map validation outside the LSP client flow.

Source: `@volar/kit/lib/createChecker.d.ts`.

| Checker | Inputs | Returns or relevance |
| --- | --- | --- |
| `createTypeScriptChecker` | `languagePlugins`, `languageServicePlugins`, `tsconfig`, optional `includeProjectReference`, optional `setup`. | Returns `check(fileName)`, `fixErrors(...)`, `printErrors(...)`, `getRootFileNames()`, `language`, `fileCreated(fileName)`, `fileUpdated(fileName)`, and `fileDeleted(fileName)`. Secondary evidence path for type safety, not the first `inspect_symbol` path. |
| `createTypeScriptInferredChecker` | `languagePlugins`, `languageServicePlugins`, `getScriptFileNames`, optional `compilerOptions`, optional `setup`. | Possible in-memory fixture checker for `.featuretype` fence diagnostics. |

The checker can support future diagnostics work, but the MCP `inspect_symbol` MVP must pass through the language server session.

## VS Code extension affordance

Documents client-side helpers that are not required for the MCP MVP.

Source: `@volar/vscode/index.d.ts`.

| Helper | Role |
| --- | --- |
| `getTsdk` | Resolves the TypeScript SDK path from VS Code. |
| `activateAutoInsertion` | Client helper for auto insertion. |
| `activateDocumentDropEdit` | Client helper for drop edits. |
| `activateFindFileReferences` | Client helper for file references. |
| `activateReloadProjects` | Client helper for reload project command. |
| `activateTsConfigStatusItem` | Client helper for tsconfig status. |
| `activateTsVersionStatusItem` | Client helper for TS version status. |
| `createLabsInfo` | Volar Labs extension export bridge. |
| `middleware` | `vscode-languageclient` middleware. |
| `parseServerCommand` | Client command adapter. |

These are useful for a VS Code extension surface, but they should not shape the MCP-first `.featuretype` MVP.

## Current Featuretype service plugin affordance

Records the repo-local structural service plugin that can coexist with TypeScript fence semantics.

Source: `packages/service/src/servicePlugin.ts`.

| Area | Current affordance |
| --- | --- |
| Service name | `featuretype`. |
| Current responsibilities | Structural diagnostics for malformed fence metadata; document symbols for parsed TypeScript fences. |
| Embedded document handling | Uses `context.decodeEmbeddedDocumentUri` to recover the source `.featuretype` document; uses `context.language.scripts.get` to access the generated root; checks `FeatureTypeVirtualCode` before reading parsed document data. |
| MVP boundary | Do not replace TypeScript hover/definition/reference providers; keep TypeScript semantics delegated to Volar plus `volar-service-typescript`. |

This plugin is for `.featuretype` structure; TypeScript semantics should remain delegated to Volar plus `volar-service-typescript`.

## Structural diagnostics placement affordance

Shows where malformed fence metadata and duplicate virtual modules should surface.

```ts
// Source: packages/service/src/servicePlugin.ts

function toDiagnostic(document, error: FeatureParseError) {
  const range = error.range ?? { start: 0, end: 0 }

  return {
    code: error.code,
    message: error.message,
    range: {
      start: document.positionAt(range.start),
      end: document.positionAt(range.end),
    },
    severity: error.severity === "warning"
      ? DiagnosticSeverity.Warning
      : DiagnosticSeverity.Error,
    source: "featuretype",
  }
}
```

```ts
// Source: /tmp/featuretype-volar-research/mdx-analyzer/packages/language-service/lib/service-plugin.js

provideDiagnostics(document) {
  const decoded = context.decodeEmbeddedDocumentUri(URI.parse(document.uri))
  const sourceScript = decoded && context.language.scripts.get(decoded[0])
  const virtualCode = decoded && sourceScript?.generated?.embeddedCodes.get(decoded[1])

  if (!(virtualCode instanceof VirtualMdxCode)) {
    return
  }

  if (virtualCode.error) {
    return [{
      message: virtualCode.error.message,
      range: virtualCode.error.place ? fromPlace(virtualCode.error.place) : zeroRange,
      severity: 1,
      source: "MDX",
    }]
  }
}
```

```ts
// Source: /tmp/featuretype-volar-research/volar-starter/packages/language-server/src/index.ts

provideDiagnostics(document) {
  const decoded = context.decodeEmbeddedDocumentUri(URI.parse(document.uri))
  const virtualCode = context.language.scripts.get(decoded[0])?.generated?.embeddedCodes.get(decoded[1])

  if (!(virtualCode instanceof Html1VirtualCode)) {
    return
  }

  return duplicateStyleNodes.map(node => ({
    severity: 2,
    range: {
      start: document.positionAt(node.start),
      end: document.positionAt(node.end),
    },
    source: "html1",
    message: "Only one style tag is allowed.",
  }))
}
```

The placement is now clear: parser and fence-contract errors belong in the Featuretype service plugin. TypeScript diagnostics should stay delegated to `volar-service-typescript` for the fenced code body.

## Affordance relevance map

Classifies all audited Volar affordances for the current MVP.

| Relevance | Affordances |
| --- | --- |
| Must use for the MVP | `@volar/language-core` `LanguagePlugin`; `VirtualCode`; `CodeInformation`; `@volar/source-map` `Mapping`; `@volar/language-service` feature workers; embedded URI encode/decode; `@volar/typescript` `extraFileExtensions`; `getExtraServiceScripts`; `createLanguageServiceHost`; `@volar/language-server` `createTypeScriptProject`; `volar-service-typescript` semantic plugin. |
| Preserve for near-future surfaces | Diagnostics; document symbols; references; hover; signature help; definition; type definition; implementation; workspace symbols; semantic tokens; inlay hints; rename. |
| Useful for later evidence | `@volar/test-utils` `startLanguageServer`; `@volar/test-utils` `printSnapshots`; `@volar/kit` `createTypeScriptChecker`; `@volar/kit` `createTypeScriptInferredChecker`. |
| Not the first MVP lane | `@volar/vscode` client helpers; `@volar/typescript` `createLanguageServicePlugin`; `runTsc`; `proxyCreateProgram`; `decorateLanguageServiceHost`. |
| Probably unneeded for raw fence MVP | `linkedCodeMappings`; `associatedScriptMappings`; `CodegenContext.getAssociatedScript`; custom file-system provider; custom TypeScript module resolver. |

The most dangerous gap is not knowing these boundaries and accidentally implementing custom logic where Volar already owns the behavior.

## Whole Volar package surface coverage

Classifies every Volar package surface found in the installed repo dependencies and upstream Volar workspace.

| Package | Coverage | Evidence | Featuretype use or revisit trigger |
| --- | --- | --- | --- |
| `@volar/source-map` | Direct MVP affordance | Installed at `2.4.28`; `SourceMap` stores mappings; `translateOffset` supports source/generated offset translation. | Exact `.featuretype` fence body offsets must map to generated TypeScript offsets and back. |
| `@volar/language-core` | Direct MVP affordance | Installed at `2.4.28`; exposes `LanguagePlugin`, `VirtualCode`, `CodeMapping`, `CodeInformation`, `FileMap`, and `forEachEmbeddedCode`. | Recognize `.featuretype`, create root virtual code, expose TypeScript fence virtual code, and gate semantic/navigation features. |
| `@volar/language-service` | Direct MVP affordance | Installed at `2.4.28`; feature workers map source positions to embedded documents and mapped results back to source documents; embedded URI encode/decode is used by TypeScript result conversion. | Route MCP `inspect_symbol` through hover, signature help, definition, type definition, implementation, and references without custom symbol routing. |
| `@volar/language-server` | Direct MVP affordance | Installed at `2.4.28`; `createTypeScriptProject` wires TypeScript projects into the Volar server; Featuretype already calls it. | Host the language service used by the existing MCP diagnostics session. |
| `@volar/typescript` | Direct MVP affordance | Installed at `2.4.28`; `extraFileExtensions` includes `.featuretype` in mixed-content TypeScript projects; `getExtraServiceScripts` registers importable generated TypeScript scripts; the host provides `fileExists`, `readFile`, and `getScriptSnapshot` over extra service scripts. | Make each TypeScript fence participate in TypeScript type checking and same-file imports. |
| `volar-service-typescript` | Direct MVP affordance | Installed at `0.0.65`; semantic plugin provides hover, signature help, definitions, type definitions, implementations, references, and diagnostics; `fileNameToUri` maps extra service script file names to embedded document URIs. | Provide the TypeScript language intelligence that `inspect_symbol` aggregates. |
| `@volar/kit` | Scoped out for MVP | Installed at `2.4.28`; `createTypeScriptChecker` and `createTypeScriptInferredChecker` provide headless checker paths. | Revisit for a CLI checker, batch diagnostics command, or non-LSP documentation validation path. |
| `@volar/test-utils` | Adjacent preserve affordance | Installed at `2.4.28`; `startLanguageServer` opens in-memory documents and sends LSP requests; `printSnapshots` prints generated virtual code and source mappings. | Preserve as an evidence harness for mapping behavior; it is not part of runtime. |
| `@volar/vscode` | Scoped out for MVP | Installed at `2.4.28`; helpers include `activateAutoInsertion`, `getTsdk`, `createLabsInfo`, and server client wiring. | Revisit when the surface shifts from MCP-first behavior to a VS Code extension or Volar Labs debugging surface. |
| `@volar/monaco` | Scoped out for MVP | Upstream package exists under `/tmp/featuretype-volar-research/volar-js/packages/monaco`; provides Monaco worker language service, provider registration, markers, and auto insertion; not installed here. | Revisit for browser-editor support. |
| `@volar/jsdelivr` | Scoped out for MVP | Upstream package exists under `/tmp/featuretype-volar-research/volar-js/packages/jsdelivr`; `createNpmFileSystem` fetches package files and types from jsDelivr; not installed here. | Revisit for browser-hosted language service with remote npm package type resolution. |
| `@volar/eslint` | Scoped out for MVP | Upstream package exists under `/tmp/featuretype-volar-research/volar-js/packages/eslint`; `createProcessor` maps virtual code into ESLint processor blocks; not installed here. | Revisit for ESLint participation over fenced TypeScript or generated virtual code. |

No package surface is allowed to remain implicit: it is either direct MVP, adjacent to preserve, scoped out, or a named gap.

## Language-service feature family coverage

Classifies Volar service features around the narrow `inspect_symbol` MVP.

| Feature family | Coverage | Mapping flags | Note |
| --- | --- | --- | --- |
| `inspect_symbol` required | Hover, signature help, definition, type definition, implementation, references. | `semantic`, `navigation`, `completion` | `completion` matters because Volar gates signature help through completion-style mapping data. |
| Type safety required | Document diagnostics and workspace diagnostics. | `verification` | Structural fence diagnostics remain Featuretype responsibility. |
| Source-map adjacent | Document symbols, workspace symbols, document highlights, semantic tokens, inlay hints, selection ranges, folding ranges. | Feature-specific structural/semantic flags. | Preserve compatibility, but these are not the one-command MCP MVP. |
| Editing adjacent | Completion, completion resolve, rename, prepare rename, code actions, code action resolve, file rename edits, formatting, auto insertion, linked editing. | Feature-specific completion/navigation/format flags. | Keep out of scope while symbol introspection remains the target behavior. |
| Hierarchy adjacent | Call hierarchy, type hierarchy, moniker, file references, document links, document colors, inline values, document drop edits. | Feature-specific navigation/structure flags. | Keep mappings compatible, but do not expand MCP requirements to these surfaces. |

This prevents accidental scope creep: preserving a feature family is different from building an MVP requirement around it.

## Affordance ledger

Summarizes the Volar affordances that directly matter for the MVP.

| Affordance | Volar API | Current Featuretype use | MVP use |
| --- | --- | --- | --- |
| Source recognition | `LanguagePlugin.getLanguageId` | `.featuretype` resolves to `featuretype`. | Same. |
| Virtual root | `LanguagePlugin.createVirtualCode` | Markdown fence parser creates `FeatureTypeVirtualCode`. | Markdown fence parser creates the `.featuretype` root virtual code. |
| Embedded fence code | `VirtualCode.embeddedCodes` | `ts`/`tsx` fences become TS/TSX embedded codes. | Each `ts`/`tsx` fence with `file=` becomes one TS/TSX embedded code. |
| Source mappings | `VirtualCode.mappings` | Fence code body maps one-to-one to raw generated TS. | Fence code body maps one-to-one to raw generated TS. |
| Feature gates | `CodeInformation` | Current mappings already use feature flags. | `semantic`, `navigation`, `completion`, and `verification` are required. |
| TypeScript participation | `typescript.extraFileExtensions` | `.featuretype` is mixed content. | Same. |
| Importable virtual modules | `typescript.getExtraServiceScripts` | Same-directory virtual file names derive from valid fence `file=` specifiers. | Same-directory virtual file names derive from fence `file=` specifiers. |
| Same-file imports | TypeScript `fileExists` and `readFile` over the Volar module-resolution host. | Proven for Markdown fences in language-server and MCP integration tests. | Resolve `./helper.ts` to an extra service script registered from the same `.featuretype` source. |
| LSP routing | `@volar/language-service` feature workers. | Standard LSP requests route through Volar. | Map `.featuretype` source positions into virtual TS positions and map TypeScript results back. |
| MCP surface | Existing `inspect_symbol`. | Aggregates hover, signature, definition, type definition, implementation, and references. | No new command if Volar mappings work at positions inside TS fences. |

This ledger is the implementation guardrail: every implementation step should preserve these affordances before adding custom logic.

## Affordance coverage gate

Defines what counts as complete coverage for the fenced TypeScript `inspect_symbol` MVP.

| Behavior | Coverage | Evidence | Featuretype implementation work | Risk |
| --- | --- | --- | --- | --- |
| Source file recognition | Covered by Featuretype | `packages/service/src/languagePlugin.ts` recognizes `.featuretype`; diagnostics support includes `.featuretype`; server watcher includes `**/*.{featuretype,ts,tsx,js,jsx,json}`. | None for source recognition. | Low |
| Markdown fence parsing | Implemented | Volar consumes `VirtualCode`; it does not parse Markdown fences. `micromark@4.0.2` exposes concrete token events with start/end offsets. Core parser tests cover exact offsets, multibyte text, CRLF, empty fences, and unclosed fences. | Keep malformed-fence diagnostics structural and source-mapped. | Medium |
| Fence module identity | Implemented | `@volar/typescript` accepts caller-supplied extra service script `fileName` values; the host registers those names directly in `extraScriptRegistry`; the `.featuretype` parser validates explicit relative `file=` values for importable fences and treats duplicates, parent traversal, URL-like values, extension mismatch, and real-file shadowing as structural errors. | Keep diagnostics attached to fence metadata ranges. | Medium |
| Same-file import resolution | Covered by Volar | The Volar TypeScript host `fileExists` checks `getScriptVersion`; `readFile` reads extra service script snapshots; module resolution delegates to TypeScript with a Volar-aware host. | No missing Volar affordance; implementation proof should use the documented fence contract. | Medium |
| Virtual module collision policy | Implemented | `extraScriptRegistry` is a `FileMap` keyed by normalized `fileName`; later entries can shadow earlier ones; extra script names are checked before real files. The parser rejects duplicate normalized virtual file names and real-file shadowing. | Preserve diagnostics on every colliding fence. | Medium |
| Project version invalidation | Proven by test | `createLanguageServiceHost.sync()` refreshes registries when `projectHost.getProjectVersion` changes; document changes and watched-file changes increment Volar project version; watched-file changes also increment `sys.version`, which is the explicit TypeScript module-resolution cache clear trigger observed in `@volar/typescript`. | Language-server test confirms changing only `file=` and notifying the watched file refreshes definition behavior. | Medium |
| Source-to-generated mapping | Covered by Volar | Feature workers map source positions into embedded virtual positions; `CodeInformation` gates semantic/navigation/completion/verification features. | No missing Volar affordance; implementation proof should include multibyte text and fence edge cases. | Medium |
| Generated-to-source result mapping | Proven by test | Definition and reference providers decode embedded target URIs and map target ranges back through source maps; `volar-service-typescript` maps extra service script file names to embedded document URIs. | Language-server and MCP integration tests confirm same-file imports return `.featuretype` ranges. | Medium |
| `inspect_symbol` MCP routing | Covered by Featuretype | `inspectSymbol` calls hover, signature, definition, type definition, implementation, and references; diagnostics session forwards to standard LSP requests. | None if Volar mapping works. | Medium |
| Type-safety diagnostics | Covered by Volar | `volar-service-typescript` exposes semantic diagnostics; Volar diagnostics map back through `shouldReportDiagnostics`; fence body mappings need `verification: true`. | Structural fence diagnostics remain Featuretype-owned. | Medium |
| External package imports | Proven through TypeScript | TypeScript module resolution remains the underlying resolver. | Language-server test proves a fenced module can import `ReactNode` from `react` while also using an extensionless same-file fence import. No custom package resolver is needed. | Low |

Coverage is complete when no behavior depends on an unknown Volar affordance. The remaining work is implementation and proof against this contract.

## Implementation proof boundary

Separates covered Volar affordances from the proof now provided by this MVP.

| Behavior | Affordance coverage | Later proof shape |
| --- | --- | --- |
| Same-file import resolution | Covered by `getExtraServiceScripts`, `fileExists`, `readFile`, and TypeScript module resolution over the Volar host. | Confirmed by language-server definition/reference tests and MCP `inspect_symbol` integration. |
| Source-to-generated mapping | Covered by `languageFeatureWorker`, `getGeneratedPositions`, source maps, and `CodeInformation` feature gates. | Confirmed by core offset tests and TypeScript diagnostics mapped to fenced source code. |
| Generated-to-source result mapping | Covered by definition/reference workers, embedded URI decode, and `volar-service-typescript` `fileNameToUri`. | Confirmed by definition and reference results reported against `.featuretype` source. |
| `file=` metadata diagnostics | Covered by the Featuretype service plugin diagnostic affordance. | Confirmed by duplicate `file=` structural diagnostics. |
| Module-resolution invalidation | Covered by Volar project-version and watched-file/sys-version levers. | Confirmed by changing only `file=` and notifying the watched file before a definition request. |

These are not reasons to invent custom language-service routing. They are the proof targets that now guard the implemented MVP.

## Implementation risk ledger

Tracks the risks implementation must respect after reading Volar source.

| Risk | Why it matters | Volar affordance | Featuretype work still needed |
| --- | --- | --- | --- |
| Parser offset provenance | A fence parser that loses exact offsets will make `inspect_symbol` look flaky even if Volar is working. | `VirtualCode.mappings` accepts exact `sourceOffsets`, `generatedOffsets`, and lengths. | Implemented with `micromark` offsets; core tests cover prose, multibyte text, CRLF, empty fences, and unterminated fences; service tests print Volar source-map evidence. |
| `file=` contract | Same-file imports cannot work predictably without a stable mapping from `file=` to TypeScript module identity. | `TypeScriptExtraServiceScript.fileName` is the importable module identity. | Implemented: `file=` is required for importable fences, anonymous fences are not importable, paths are relative `./` child paths, extensions must match the fence language, and invalid values are structural diagnostics. |
| Virtual versus real file shadowing | A fence `file="./helper.ts"` may silently shadow a real `helper.ts` in the same directory. | `extraScriptRegistry` is checked before `sys.fileExists`. | Implemented and proven through core, LSP, and MCP diagnostics: real-file shadowing is rejected before registration. |
| Module-resolution invalidation | Changing only `file=` could leave TypeScript's module-resolution cache pointed at the previous virtual path. | Document changes update `projectHost.getProjectVersion`; watched-file notifications update both project version and `sys.version`; `sys.version` is the observed module-resolution-cache clear trigger. | Proven through language-server tests for both document-only `file=` edits and watched-file notifications. |
| Embedded target result mapping | Definitions/references may return encoded embedded URIs unless Volar's target mapping sees every fence virtual code. | `volar-service-typescript` maps extra script names to embedded URIs; language-service definition/reference providers map embedded targets back to source documents. | Proven through language-server and MCP tests: definition/reference output reports `.featuretype` ranges and does not leak virtual `.ts` paths or `volar-embedded-content:` URIs. |
| Structural diagnostics placement | TypeScript diagnostics cannot explain malformed fence metadata or duplicate virtual module declarations. | A Featuretype service plugin can provide document diagnostics independent of TypeScript. | Implemented in the Featuretype service plugin and proven through LSP/MCP diagnostics for invalid paths, missing extension, extension mismatch, duplicates, and real-file shadowing. |
| MCP position contract | MCP callers pass `.featuretype` source positions; positions outside mapped code should fail gently. | `languageFeatureWorker` returns no result when `getGeneratedPositions` yields nothing, and current `inspect_symbol` already falls back to `explainFailure` when every semantic section is empty. | Proven through MCP tests: fenced positions inspect symbols, query fallback resolves TypeScript child symbols, and prose/headings/fence metadata receive a fence-specific failure explanation. |

This remains implementation-risk guidance for future expansion, not a reason to invent custom routing.

## Resolved research checks

Records questions that were open during the research pass and the current conclusions.

| Check | Current lean |
| --- | --- |
| Which Markdown parser should own fence offsets and info-string ranges? | Use `micromark` events for the MVP fence extractor. MDX's `remark-parse`/unist precedent remains useful, but a full mdast pipeline is not required for fence-only symbol introspection. |
| What should happen when two fences declare the same file specifier? | The documented contract makes duplicate normalized virtual file names structural errors on every colliding fence. |
| Can a TS fence without `file=` participate in same-file imports? | No. It may be type checked through an internal synthetic file name, but authored imports require explicit `file=` in the MVP. |
| Do any `inspect_symbol` sections leak virtual paths such as `/repo/docs/helper.ts`? | Current MCP integration proof confirms the target surface maps back to `.featuretype` and does not expose virtual `.ts` paths or `volar-embedded-content:` URIs. |
| Does `volar-service-typescript` `0.0.71` change mapping or import behavior relevant to extra service scripts? | The extra service script to embedded URI bridge is unchanged between installed `0.0.65` and refreshed `0.0.71`; keep remaining drift review focused on package upgrade risk, not the core mapping affordance. |

These conclusions are now reflected in the implemented MVP and should be preserved during future expansion.
