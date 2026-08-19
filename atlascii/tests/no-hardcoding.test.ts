import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { defaultMarks } from "../src/config/marks.ts";
import { figures } from "../src/config/figures.ts";

/**
 * Configurable content must not reappear as a literal in a component.
 *
 * Centralising it once is not the same as keeping it centralised: the next
 * component to want a separator will type `" · "` unless something objects.
 * This is that objection.
 *
 * Only distinctive values are checked. A mark like `"("` or a figure like `"x"`
 * occurs constantly in ordinary code, and flagging those would train everyone
 * to ignore the test — which is worse than not having it.
 */
/**
 * Source with comments removed.
 *
 * Documentation quotes the output it describes — a doc comment showing
 * `stdout | file > suite` contains the count separator without hardcoding
 * anything. Scanning prose for punctuation finds only prose.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const configurable = async () => {
  const files = await sourceFiles(new URL("../src", import.meta.url).pathname);
  return Promise.all(
    files.map(async (path) => ({
      path,
      source: withoutComments(await readFile(path, "utf8")),
    })),
  );
};

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      // `config/` is where these values are defined; it is the one place they
      // are supposed to appear.
      if (entry.name === "config") return Promise.resolve([]);
      if (entry.isDirectory()) return sourceFiles(path);
      return Promise.resolve(path.endsWith(".ts") ? [path] : []);
    }),
  );
  return found.flat();
};

/**
 * Values worth checking: non-ASCII, or longer than one character.
 *
 * A mark like `"("` occurs constantly in ordinary code, and flagging it would
 * train everyone to ignore the test — worse than not having it.
 */
const distinctive = (value: string) =>
  value.trim().length > 0 && (value.length > 1 || /[^\x20-\x7E]/.test(value));

/**
 * Marks are deliberately not checked this way.
 *
 * Their values are common punctuation — `", "`, `" | "`, `" ("` — which appear
 * legitimately in type unions (`"SKIP" | "TODO"`), array literals, and any
 * template containing a comma. Every filter narrow enough to exclude those also
 * misses real hardcoding, and a guard that reports noise gets ignored, which is
 * worse than no guard. Marks are held by review and by the fact that
 * `defaultMarks` is one short file anyone changing punctuation will find.
 *
 * Glyphs have no such problem: `❯` and `├──` never occur incidentally, so
 * finding one outside `config/` is unambiguous.
 */
test("no component hardcodes a figure that config defines", async () => {
  const glyphs = Object.entries(figures).filter(([, value]) => distinctive(value));
  const offenders = (await configurable()).flatMap(({ path, source }) =>
    glyphs
      .filter(([, value]) => source.includes(value))
      .map(([name]) => `${path.split("/src/")[1]} hardcodes figures.${name}`),
  );
  expect(offenders).toEqual([]);
});

test("checks a set large enough to be worth having", async () => {
  // A guard that examines two values passes for the wrong reason. If the
  // distinctive filter ever narrows to almost nothing, this fails rather than
  // quietly checking nothing — the same failure the catalog guard had.
  expect(Object.values(figures).filter(distinctive).length).toBeGreaterThan(4);
});
