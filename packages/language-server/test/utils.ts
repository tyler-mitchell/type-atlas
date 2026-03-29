import { createRequire } from "node:module";
import path from "node:path";
import { startLanguageServer } from "@volar/test-utils";
import { URI, Utils } from "vscode-uri";
import pkg from "../package.json" with { type: "json" };

const require = createRequire(import.meta.url);

export const tsdk = path.dirname(require.resolve("typescript"));

export function createServer(): ReturnType<typeof startLanguageServer> {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const packageRequire = createRequire(packageJsonUrl);
  const binPath = packageRequire.resolve(pkg.bin["featuretype-language-server"]);

  return startLanguageServer(binPath, new URL("..", import.meta.url));
}

export function fixtureUri(fileName: string) {
  return String(
    Utils.joinPath(
      URI.file("/Users/tylermitchell/Projects/featuretype/fixtures/demo-workspace"),
      fileName,
    ),
  );
}

export function fixturePath(fileName: string) {
  return URI.parse(fixtureUri(fileName)).fsPath.replaceAll("\\", "/");
}
