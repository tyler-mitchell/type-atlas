import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { defaultMessages } from "../src/config/messages.ts";

/**
 * Every key a component asks for must exist in the default catalog, and every
 * key the catalog carries must be asked for.
 *
 * A hand-written list of keys only checks the ones its author remembered, which
 * is the failure it was meant to catch. This reads the source instead.
 *
 * `messages.ts` is excluded from the scan: it *defines* the catalog, so
 * including it would let every key match its own definition and the check would
 * pass no matter what.
 */
const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return Promise.resolve(path.endsWith(".ts") && !path.endsWith("messages.ts") ? [path] : []);
    }),
  );
  return found.flat();
};

const callers = async () => {
  const files = await sourceFiles(new URL("../src", import.meta.url).pathname);
  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
};

/** Keys built at runtime, and every value each can produce. */
const families: Readonly<Record<string, readonly string[]>> = {
  "`diagnostic.severity.${": [
    "diagnostic.severity.1",
    "diagnostic.severity.2",
    "diagnostic.severity.3",
    "diagnostic.severity.4",
  ],
  "`symbol.kind.${": Array.from({ length: 26 }, (_, index) => `symbol.kind.${index + 1}`),
};

test("defines every key asked for as a literal", async () => {
  const source = await callers();
  const asked = [
    ...new Set(
      [
        ...source.matchAll(/\bword\(\s*"([a-z][a-z.]+)"/gi),
        ...source.matchAll(/\bkey:\s*"([a-z][a-z.]+)"/gi),
      ].map((match) => match[1]!),
    ),
  ];

  expect(asked.length, "the scan found no keys, so it is not scanning").toBeGreaterThan(0);
  expect(asked.filter((key) => defaultMessages[key] === undefined)).toEqual([]);
});

test("defines every key a computed family can produce", async () => {
  // A literal scan cannot see `scope.${kind}` or `diagnostic.severity.${n}`.
  // Each family is enumerated here, and its presence in the source asserted —
  // so a family that disappears fails rather than silently skipping its keys.
  const source = await callers();
  for (const [prefix, keys] of Object.entries(families)) {
    expect(source.includes(prefix), `${prefix} is still built dynamically`).toBe(true);
    expect(keys.filter((key) => defaultMessages[key] === undefined)).toEqual([]);
  }
});

test("carries no key nothing asks for", async () => {
  // A catalog that outlives its callers is a translation burden for words that
  // never appear in any output.
  const source = await callers();
  const dynamic = new Set(Object.values(families).flat());
  const unused = Object.keys(defaultMessages).filter(
    (key) => !dynamic.has(key) && !source.includes(`"${key}"`),
  );
  expect(unused).toEqual([]);
});
