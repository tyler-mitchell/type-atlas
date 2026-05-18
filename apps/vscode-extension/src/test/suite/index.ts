import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";

const extensionName = "featuretype-language-features";

export async function run() {
  console.log("FeatureType VS Code verification: starting");
  const extension = findFeatureTypeExtension();
  assert.ok(extension, "FeatureType extension is registered in VS Code.");

  await verifyManifestAndGrammar(extension.extensionPath);

  const exports = await withTimeout(
    extension.activate(),
    20_000,
    "FeatureType extension activation",
  );
  assert.equal(extension.isActive, true, "FeatureType extension activates.");
  assert.ok(exports, "FeatureType extension returns Volar Labs exports.");
  console.log("FeatureType VS Code verification: extension activated");

  const workspaceRoot = getWorkspaceRoot();
  const sameFileUri = vscode.Uri.file(
    path.join(workspaceRoot, "same-file-import.featuretype"),
  );
  const document = await vscode.workspace.openTextDocument(sameFileUri);
  assert.equal(document.languageId, "featuretype");
  await vscode.window.showTextDocument(document);

  const helperCall = document.getText().indexOf("helper(\"ok\")");
  assert.notEqual(helperCall, -1, "same-file fixture includes helper call.");
  const helperPosition = document.positionAt(helperCall + 1);

  const hover = await waitFor(
    async () => vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      sameFileUri,
      helperPosition,
    ),
    (value) => (value?.length ?? 0) > 0,
    "hover inside a TypeScript fence",
  );
  assert.match(formatHover(hover), /helper/);
  console.log("FeatureType VS Code verification: hover succeeded");

  const definitions = await waitFor(
    async () => vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      "vscode.executeDefinitionProvider",
      sameFileUri,
      helperPosition,
    ),
    (value) => (value?.length ?? 0) > 0,
    "definition through a same-file fence import",
  );
  assert.ok(
    definitions?.some((location) =>
      getLocationUri(location).fsPath.endsWith("same-file-import.featuretype")
    ),
    "definition maps back to the authored .featuretype document.",
  );
  console.log("FeatureType VS Code verification: definition succeeded");

  const brokenUri = vscode.Uri.file(
    path.join(workspaceRoot, "broken-button.featuretype"),
  );
  await vscode.workspace.openTextDocument(brokenUri);
  const diagnostics = await waitFor(
    () => Promise.resolve(vscode.languages.getDiagnostics(brokenUri)),
    (value) => value.some((diagnostic) =>
      diagnostic.source === "ts" &&
      diagnostic.message.includes("destructive")
    ),
    "TypeScript diagnostics inside a TypeScript fence",
  );
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.source === "ts"),
    "fenced TypeScript diagnostics are editor-visible.",
  );
  console.log("FeatureType VS Code verification: diagnostics succeeded");
}

function findFeatureTypeExtension() {
  return vscode.extensions.all.find((extension) =>
    extension.packageJSON?.name === extensionName
  );
}

async function verifyManifestAndGrammar(extensionPath: string) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(extensionPath, "package.json"), "utf8"),
  );
  assert.deepEqual(manifest.activationEvents, ["onLanguage:featuretype"]);

  const language = manifest.contributes.languages.find((entry: { id?: string }) =>
    entry.id === "featuretype"
  );
  assert.ok(language, "manifest contributes the featuretype language id.");
  assert.deepEqual(language.extensions, [".featuretype"]);

  const grammar = manifest.contributes.grammars.find((entry: { language?: string }) =>
    entry.language === "featuretype"
  );
  assert.deepEqual(grammar.embeddedLanguages, {
    "source.ts": "typescript",
    "source.tsx": "typescriptreact",
  });

  const grammarJson = JSON.parse(
    await fs.readFile(
      path.join(extensionPath, "syntaxes", "featuretype.tmLanguage.json"),
      "utf8",
    ),
  );
  assert.equal(grammarJson.repository.fencedTs.contentName, "source.ts");
  assert.equal(grammarJson.repository.fencedTsx.contentName, "source.tsx");
}

function getWorkspaceRoot() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "VS Code test has a workspace folder.");
  return workspaceFolder.uri.fsPath;
}

async function waitFor<T>(
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  label: string,
) {
  const startedAt = Date.now();
  let current = await withTimeout(read(), 5_000, label);

  while (!isReady(current)) {
    if (Date.now() - startedAt > 20_000) {
      throw new Error(`Timed out waiting for ${label}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    current = await withTimeout(read(), 5_000, label);
  }

  return current;
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  label: string,
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function formatHover(hovers: readonly vscode.Hover[] | undefined) {
  return (hovers ?? [])
    .flatMap((hover) => hover.contents)
    .map((content) => typeof content === "string" ? content : content.value)
    .join("\n\n");
}

function getLocationUri(location: vscode.Location | vscode.LocationLink) {
  return location instanceof vscode.Location
    ? location.uri
    : location.targetUri;
}
