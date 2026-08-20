import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";

const run = promisify(execFile);

/**
 * Imports the package the way a consumer does: plain Node, no bundler.
 *
 * Everything else in this suite runs through Vite, which rewrites imports on
 * the way in. That hid a real defect — Markdoc ships CommonJS, so
 * `import { Tag } from "@markdoc/markdoc"` type-checks, passes every test here,
 * and throws the moment a consumer loads it under Node. A bundler-backed suite
 * structurally cannot see that, so this test steps outside it.
 */
const importsCleanly = async (specifier: string) => {
  const { stdout } = await run(
    process.execPath,
    [
      "--conditions=development",
      "-e",
      `import(${JSON.stringify(specifier)}).then((m) => console.log(Object.keys(m).length)).catch((error) => { console.error(error.message); process.exit(1); })`,
    ],
    { cwd: new URL("..", import.meta.url).pathname },
  );
  return Number(stdout.trim());
};

test("loads under plain Node, not only under a bundler", async () => {
  await expect(importsCleanly("atlascii")).resolves.toBeGreaterThan(0);
});

test("exports every subpath its package map advertises", async () => {
  // A map naming a file that no longer exists resolves to nothing, and only an
  // import outside the bundler finds out.
  const { exports: map } = await import("../package.json", { with: { type: "json" } }).then(
    (module) => module.default as { exports: Record<string, unknown> },
  );
  const subpaths = Object.keys(map).map((key) => key.replace(/^\./, "atlascii"));
  for (const subpath of subpaths) {
    await expect(importsCleanly(subpath), subpath).resolves.toBeGreaterThan(0);
  }
});
