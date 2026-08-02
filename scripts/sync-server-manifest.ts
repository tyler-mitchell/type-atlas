import { readFile, writeFile } from "node:fs/promises";

type PackageManifest = {
  name: string;
  version: string;
};

type ServerManifest = {
  name: string;
  version: string;
  packages: Array<{
    identifier: string;
    version: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

const packagePath = new URL("../packages/mcp/package.json", import.meta.url);
const serverPath = new URL("../server.json", import.meta.url);
const packageManifest = JSON.parse(await readFile(packagePath, "utf8")) as PackageManifest;
const serverManifest = JSON.parse(await readFile(serverPath, "utf8")) as ServerManifest;

if (serverManifest.name !== "io.github.tyler-mitchell/type-atlas") {
  throw new Error(`Unexpected MCP Registry name: ${serverManifest.name}`);
}

if (!serverManifest.packages.some(({ identifier }) => identifier === packageManifest.name)) {
  throw new Error(`server.json does not publish ${packageManifest.name}`);
}

const synchronizedManifest = {
  ...serverManifest,
  version: packageManifest.version,
  packages: serverManifest.packages.map((entry) =>
    entry.identifier === packageManifest.name
      ? { ...entry, version: packageManifest.version }
      : entry,
  ),
};

await writeFile(serverPath, `${JSON.stringify(synchronizedManifest, null, 2)}\n`);
