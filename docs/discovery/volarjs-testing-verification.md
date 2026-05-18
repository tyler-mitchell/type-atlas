# Volar.js Testing Verification

Maintainer reference for proving `.featuretype` Volar behavior without confusing adjacent evidence for plugin proof.

## Source set

Primary references for the verification strategy.

```txt
Official Volar docs:
- https://volarjs.dev/core-concepts/embedded-languages/
- https://volarjs.dev/reference/languages/
- https://volarjs.dev/guides/first-server/
- https://volarjs.dev/core-concepts/volar-labs/

Reference projects and installed package sources:
- https://github.com/volarjs/starter
- https://github.com/volarjs/volar.js/tree/master/packages/test-utils
- /tmp/featuretype-volar-docs/volar-starter/packages/vscode/src/extension.ts
- /tmp/featuretype-volar-docs/volar-starter/.vscode/launch.json
- node_modules/.pnpm/@volar+test-utils@2.4.28/node_modules/@volar/test-utils
- /tmp/featuretype-volar-docs/volar-starter
- /tmp/featuretype-volar-docs/volar-js/packages/test-utils
```

## Verification ladder

Use the lowest lane that proves the claim, and do not let a weaker lane imply a stronger one.

```txt
1. Virtual-code mapping proof
   Proves authored source offsets map to generated embedded TS/TSX offsets.
   Tool: @volar/test-utils printSnapshot / printSnapshots.

2. Headless Volar LSP proof
   Proves the actual language server answers LSP requests for authored files.
   Tool: @volar/test-utils startLanguageServer.

3. VS Code Insiders extension-host proof
   Proves the packaged VS Code Insiders client activates, starts the server,
   and editor commands can reach Volar-backed language features.
   Tool: @vscode/test-electron.

4. Volar Labs inspection
   Proves what the running VS Code Volar server sees: project files, virtual
   files, source maps, and TypeScript memory. Strong manual debugging evidence.

5. Manual UI proof
   Proves only what is visibly captured in the editor. It is not sufficient
   unless hover, definition, diagnostics, or Volar Labs source-map output is
   actually visible.
```

## Embedded language contract

Volar’s own model starts with root virtual code and embedded virtual code.

```ts
// Source: https://volarjs.dev/reference/languages/
// Featuretype should keep this shape boring: one .featuretype root plus one
// embedded VirtualCode per ts/tsx fence.

export class FeatureTypeVirtualCode implements VirtualCode {
  id = "root"
  languageId = "featuretype"
  embeddedCodes: VirtualCode[] = []

  update(snapshot: ts.IScriptSnapshot) {
    // Re-parse Markdown fences.
    // Rebuild embedded TypeScript virtual code.
    // Preserve source-to-generated mappings for Volar feature workers.
  }
}
```

The official embedded-language docs name Markdown as a common mixed-language source format and frame Volar as the tool for mapping editor features across embedded sections.

```txt
Source: https://volarjs.dev/core-concepts/embedded-languages/

Relevant affordance:
- mixed-language documents are expected
- embedded languages can be mapped back to source documents
- Markdown-style files with code regions are a native fit for Volar’s model
```

## Mapping proof

Use `printSnapshot` before debugging TypeScript resolution or VS Code behavior.

```ts
// Source: @volar/test-utils index.d.ts
// Featuretype local use: packages/service/src/languagePlugin.test.ts

import { printSnapshot } from "@volar/test-utils"

const root = new FeatureTypeVirtualCode(
  URI.file("/workspace/docs/example.featuretype"),
  createSnapshot(source),
)

const embeddedCode = root.embeddedCodes[0]
const snapshot = [...printSnapshot({ snapshot: root.snapshot }, embeddedCode)]
  .join("\n")

expect(snapshot).toContain("[1] import·{·helper·}·from·\"./helper\"")
expect(snapshot).toContain("[3] export·const·root·=·helper(\"ok\")")
expect(snapshot).toContain("[8] export·const·root·=·helper(\"ok\")↵ (:8:1)")
```

This proves the generated TS text and source-map coordinates. It does not prove TypeScript semantic features by itself.

## Headless LSP proof

Use `startLanguageServer` for durable language-server behavior.

```ts
// Source: @volar/test-utils README
// Source: @volar/test-utils index.d.ts
// Featuretype local use: packages/language-server/test/utils.ts
// Featuretype local use: packages/language-server/test/diagnostics.test.ts

import { startLanguageServer } from "@volar/test-utils"

const server = startLanguageServer(serverModule, workspaceRoot)

await server.initialize(rootUri, {
  typescript: { tsdk },
})

const document = await server.openTextDocument(
  "/workspace/same-file-import.featuretype",
  "featuretype",
)

const hover = await server.sendHoverRequest(document.uri, helperPosition)
const definition = await server.sendDefinitionRequest(document.uri, helperPosition)
const references = await server.sendReferencesRequest(document.uri, helperPosition, {
  includeDeclaration: true,
})
const diagnostics = await server.sendDocumentDiagnosticRequest(document.uri)
const symbols = await server.sendDocumentSymbolRequest(document.uri)

// Assert authored .featuretype URIs and source ranges.
// Reject user-facing virtual .ts filenames in definition/reference output.
```

The installed utility really forks the language-server module over stdio and speaks LSP.

```ts
// Source: @volar/test-utils index.js

const childProcess = cp.fork(
  serverModule,
  ["--stdio", `--clientProcessId=${process.pid.toString()}`],
  { execArgv: ["--nolazy"], cwd, stdio: "pipe" },
)

const connection = createProtocolConnection(
  childProcess.stdout,
  childProcess.stdin,
)

await connection.sendRequest(InitializeRequest.type, {
  rootUri,
  initializationOptions,
  capabilities,
})
```

This is the canonical automated proof lane for the `.featuretype` language server. It proves more than parser tests and less than full VS Code extension packaging.

## VS Code extension-host proof

Use extension-host tests to prove the VS Code client path.

```ts
// Source: https://volarjs.dev/guides/first-server/
// Source: https://github.com/volarjs/starter
// Featuretype local use: apps/vscode-extension/scripts/runVscodeTests.ts

await runTests({
  extensionDevelopmentPath: extensionRoot,
  extensionTestsPath: testRunnerPath,
  launchArgs: [path.join(repoRoot, "fixtures", "demo-workspace")],
  vscodeExecutablePath,
})
```

```ts
// Source: apps/vscode-extension/src/test/suite/index.ts

const extension = findFeatureTypeExtension()
const exports = await extension.activate()

assert.equal(extension.isActive, true)
assert.ok(exports, "FeatureType extension returns Volar Labs exports.")

const document = await vscode.workspace.openTextDocument(sameFileUri)
assert.equal(document.languageId, "featuretype")

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

Extension-host proof must exercise editor commands or diagnostics. Merely launching VS Code with the extension development path is not enough.

The extension-host test is intentionally short-lived. It opens VS Code, runs assertions, and closes the extension host when the test process finishes.

```sh
pnpm run verify:volar:vscode
```

## VS Code Insiders availability

Build, package, and install the extension into VS Code Insiders when the local editor should load `.featuretype` support outside the extension-host test runner. The extension build produces the VSIX artifact.

```sh
pnpm --filter featuretype-language-features build
code-insiders --install-extension apps/vscode-extension/dist/featuretype-language-features.vsix --force
code-insiders --list-extensions --show-versions | rg "featuretype-local.featuretype-language-features"
```

Already-open VS Code Insiders windows may need a reload before they see the newly installed extension.

## VS Code extension setup

Follow Volar’s client/extension pattern before debugging editor behavior.

```jsonc
// Source: https://volarjs.dev/guides/first-server/
// Source: https://volarjs.dev/guides/file-structure/
// Source: .vscode/launch.json
{
  "name": "Launch FeatureType Volar Extension",
  "type": "extensionHost",
  "request": "launch",
  "runtimeExecutable": "${execPath}",
  "args": [
    "--extensionDevelopmentPath=${workspaceFolder}/apps/vscode-extension",
    "--folder-uri=${workspaceFolder}/fixtures/demo-workspace"
  ],
  "outFiles": [
    "${workspaceFolder}/apps/vscode-extension/dist/*.js"
  ],
  "preLaunchTask": "FeatureType Volar: watch extension"
}
```

```jsonc
// Source: .vscode/tasks.json
{
  "label": "FeatureType Volar: watch extension",
  "type": "shell",
  "command": "pnpm --filter featuretype-language-features watch",
  "isBackground": true,
  "problemMatcher": {
    "background": {
      "activeOnStart": true,
      "beginsPattern": ".*",
      "endsPattern": "watching\\.\\.\\."
    }
  }
}
```

```ts
// Source: https://volarjs.dev/guides/first-server/
// Source: https://github.com/volarjs/starter
// Source: apps/vscode-extension/src/extension.ts

const serverOptions: ServerOptions = {
  run: {
    module: serverModule,
    transport: TransportKind.ipc,
  },
  debug: {
    module: serverModule,
    transport: TransportKind.ipc,
    options: {
      execArgv: ["--nolazy", "--inspect=6010"],
    },
  },
}

const clientOptions: LanguageClientOptions = {
  documentSelector: [{ language: "featuretype" }],
  initializationOptions: {
    typescript: {
      tsdk: tsdk.tsdk,
    },
  },
}
```

The extension setup is valid only if the bundled server entry is the executable language-server process entry. For this repo, that means `apps/vscode-extension/scripts/build.ts` bundles `packages/language-server/src/server.ts` into `apps/vscode-extension/dist/server.js`.

## Manual inspection

Manual inspection uses the editor’s normal extension-development workflow. Automated proof stays in the extension-host test runner.

## Volar client shape

The VS Code extension should follow the official starter shape.

```ts
// Source: https://github.com/volarjs/starter
// Source: apps/vscode-extension/src/extension.ts

import * as serverProtocol from "@volar/language-server/protocol"
import { createLabsInfo, getTsdk } from "@volar/vscode"
import * as lsp from "vscode-languageclient/node"

const tsdk = await getTsdk(context)

const client = new lsp.LanguageClient(
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

This lane proves client/server wiring only when paired with extension-host commands or Volar Labs inspection.

## Volar Labs inspection

Use Volar Labs when the running editor behavior is confusing.

```txt
Source: https://volarjs.dev/core-concepts/volar-labs/

Relevant Volar Labs features:
- List Volar Servers
- Inspect Project
- Inspect Virtual File
- Virtual Source Maps
- TS Memory Usage
```

```txt
Featuretype use:
- confirm the FeatureType Volar server is running
- inspect which .featuretype files are in the project
- inspect generated virtual TS/TSX fence files
- inspect source maps between authored Markdown fences and virtual TS code
- check whether TypeScript memory/project state looks sane
```

Volar Labs is manual debugging evidence. Durable regression proof still belongs in `@volar/test-utils` and extension-host tests.

## Manual UI proof boundary

Manual proof must show a language feature result, not just editor presence.

```txt
Counts as manual proof:
- visible hover text for a symbol inside a .featuretype ts/tsx fence
- visible definition navigation from one fence to another authored source range
- visible TypeScript diagnostic on authored .featuretype fence source
- visible Volar Labs virtual file or source-map view for the .featuretype file

Does not count:
- the file opens in VS Code
- syntax highlighting appears
- the caret moves inside a fence
- a Problems panel warning appears for unrelated extension metadata
- a command exits without the editor-visible language result being inspected
```

## Featuretype command set

Run these when proving the current MVP.

```sh
pnpm run verify:volar
```

The aggregate command runs these lanes in order.

```sh
pnpm run verify:volar:mapping
pnpm run verify:volar:lsp
pnpm run verify:volar:vscode
```

The explicit underlying commands remain useful when isolating a failing lane.

```sh
pnpm --filter @featuretype/service test
pnpm --filter @featuretype/language-server test
pnpm --filter featuretype-language-features test:vscode
pnpm --filter @featuretype/mcp test:integration
```

Run these before claiming restart readiness for the served MCP runtime.

```sh
pnpm --filter @featuretype/service build
pnpm --filter @featuretype/language-server build
pnpm --filter @featuretype/mcp build
```

## Result interpretation

Keep failure interpretation tied to the lane that failed.

```txt
Mapping snapshot fails:
  Fix parser offsets, embedded code text, or mapping flags before LSP debugging.

Headless LSP fails:
  Fix language plugin, TypeScript project setup, extra service scripts, service
  plugins, or file-watcher refresh before VS Code debugging.

Extension-host test fails:
  Fix VS Code package manifest, extension activation, bundled server entry,
  tsdk forwarding, client startup, or editor command integration.

Volar Labs shows wrong virtual code:
  Fix the Volar virtual-code shape or mapping generation.

Manual UI does not show hover:
  First compare against headless LSP and extension-host tests, then inspect the
  running server/project/virtual file in Volar Labs.
```

## Current proof contract

The `.featuretype` MVP is proven only when these claims hold.

```txt
Virtual code:
  Each ts/tsx fence becomes raw TypeScript/TSX embedded virtual code with exact
  source-to-generated mappings.

Import resolution:
  Same-file imports between first-line module-comment fences resolve through
  Volar extra service scripts and TypeScript project host behavior.

Language features:
  Hover, definition, references, diagnostics, and document symbols work from
  authored .featuretype source positions inside ts/tsx fences.

VS Code extension:
  The extension activates for language id featuretype, starts the real language
  server process entry, forwards the workspace tsdk, and returns Volar Labs
  exports.

MCP:
  inspect_symbol keeps the same tool boundary while using Volar-backed results
  mapped back to authored .featuretype files.
```
