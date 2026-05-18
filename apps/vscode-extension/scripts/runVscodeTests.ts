import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { runTests } from "@vscode/test-electron";

const extensionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(extensionRoot, "..", "..");
const testRunnerPath = path.join(extensionRoot, "dist", "test", "suite", "index.js");
const defaultMacExecutable =
  "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron";

async function main() {
  await build({
    bundle: true,
    entryPoints: [path.join(extensionRoot, "src", "test", "suite", "index.ts")],
    external: ["vscode"],
    format: "cjs",
    outfile: testRunnerPath,
    platform: "node",
    sourcemap: true,
    target: "node18",
  });

  await runTests({
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: testRunnerPath,
    launchArgs: [path.join(repoRoot, "fixtures", "demo-workspace")],
    vscodeExecutablePath: await resolveVscodeExecutable(),
  });
}

async function resolveVscodeExecutable() {
  const configured =
    process.env.FEATURETYPE_VSCODE_EXECUTABLE ??
    process.env.VSCODE_EXECUTABLE;
  if (configured) {
    return configured;
  }

  await access(defaultMacExecutable);
  return defaultMacExecutable;
}

void main();
