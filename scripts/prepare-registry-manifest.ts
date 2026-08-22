import { readFile, writeFile } from "node:fs/promises";

const packageManifest = JSON.parse(
  await readFile(new URL("../packages/mcp/package.json", import.meta.url), "utf8"),
) as { name: string; version: string };
const template = JSON.parse(
  await readFile(new URL("../server.template.json", import.meta.url), "utf8"),
) as {
  name: string;
  packages: Array<{ identifier: string; version: string }>;
  version: string;
};

if (template.name !== "io.github.tyler-mitchell/type-atlas") {
  throw new Error(`Unexpected MCP Registry name: ${template.name}`);
}
if (!template.packages.some(({ identifier }) => identifier === packageManifest.name)) {
  throw new Error(`Registry template does not publish ${packageManifest.name}`);
}

const manifest = {
  ...template,
  version: packageManifest.version,
  packages: template.packages.map((entry) =>
    entry.identifier === packageManifest.name
      ? { ...entry, version: packageManifest.version }
      : entry,
  ),
};

await writeFile(
  new URL("../server.json", import.meta.url),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
