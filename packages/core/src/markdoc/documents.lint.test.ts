import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

/**
 * The design language, asserted against the documents rather than their output.
 *
 * Rendering a document needs data, and data written by hand is a second account
 * of what a handler produces — it drifts, and a drifted fixture depicts output
 * no tool emits. These rules need no data: they read what the documents say.
 *
 * What they cannot judge is whether a line reads well. Nothing static can. That
 * is answered by calling the tool and looking at the answer, which costs one
 * request and is the real thing rather than a reconstruction of it.
 *
 * Each rule below exists because the surface actually diverged that way.
 */

const here = dirname(fileURLToPath(import.meta.url));

const read = async (folder: string) => {
  const names = (await readdir(join(here, folder))).filter((name) => name.endsWith(".mdoc"));
  return Promise.all(
    names.map(async (name) => [name, await readFile(join(here, folder, name), "utf8")] as const),
  );
};

const documents = await read("documents");
const partials = await read("partials");
const everything = [...documents, ...partials];

/** A tool document answers a tool; the rest are fragments other documents include. */
const tools = documents.filter(([name]) => name.endsWith(".tool.mdoc"));

test("no document draws a banner by hand", () => {
  // `===` was typed into two documents before the mark existed, so a consumer
  // changing what encloses a banner would have changed some of them.
  const offenders = everything
    .filter(([, source]) => /^\s*===/m.test(source))
    .map(([name]) => name);
  expect(offenders).toEqual([]);
});

test("every tool document says which nothing it is", () => {
  // An empty body is indistinguishable from an unasked question. Every tool
  // states what it looked for and what would answer differently, which is only
  // possible if something branches on having found nothing.
  //
  // Transitive, because a tool answering per-item — a file that failed to read,
  // a package that resolved to nothing — states its absence in the partial that
  // renders the item, and that is the right place for it.
  const held = new Map(everything);
  const included = (name: string, seen = new Set<string>()): readonly string[] => {
    if (seen.has(name)) return [];
    seen.add(name);
    const source = held.get(name) ?? "";
    return [
      source,
      ...[...source.matchAll(/"([\w-]+\.mdoc)"/g)].flatMap(([, named]) => included(named, seen)),
    ];
  };
  // Four shapes, because absence is stated four honest ways: a zero count, an
  // emptiness test, a fallback value, and — for a tool answering per item — a
  // branch on the item having failed or matched nothing.
  const saysNothing = (source: string) =>
    /\{%\s*if\s+[^%]*(equals\(\$[\w.]+,\s*0\)|not\(any\(|not\(\$)/.test(source) ||
    /\bdefault\(/.test(source) ||
    /\{%\s*if\s+\$[\w.]*(error|noExportMatched|unanswered|unloaded)/i.test(source);
  const offenders = tools
    .filter(([name]) => !included(name).some(saysNothing))
    .map(([name]) => name);
  expect(offenders).toEqual([]);
});

test("sections within an answer are one heading level", () => {
  // `##` names a part inside one subject. A document reaching for `###` was
  // nesting where nothing else nests, so two tools disagreed about what a
  // section looks like.
  const offenders = everything
    .filter(([, source]) => /^#{3,}\s/m.test(source))
    .map(([name]) => name);
  expect(offenders).toEqual([]);
});

test("every partial is reached by something", () => {
  // A partial nothing includes is a shape that was replaced and left behind,
  // which is how three ways of drawing one thing survived together.
  const referenced = new Set(
    everything.flatMap(([, source]) => [...source.matchAll(/"([\w-]+\.mdoc)"/g)].map(([, n]) => n)),
  );
  expect(partials.map(([name]) => name).filter((name) => !referenced.has(name))).toEqual([]);
});

test("every partial a document names exists", () => {
  const present = new Set(partials.map(([name]) => name));
  const missing = everything.flatMap(([name, source]) =>
    [...source.matchAll(/"([\w-]+\.mdoc)"/g)]
      .map(([, named]) => named)
      .filter((named) => !present.has(named))
      .map((named) => `${name} → ${named}`),
  );
  expect(missing).toEqual([]);
});

test("nesting is drawn by the guide, never by hand", () => {
  // `tight` wrapping `indent` wrapping `each` drew a file and the rows beneath
  // it without ever consulting the guide, so those tools could not answer to a
  // style setting even in principle. `tree` is how depth is expressed.
  const offenders = everything
    .filter(([, source]) => /\{%\s*indent\s*%\}[\s\S]*\{%\s*each\s/.test(source))
    .map(([name]) => name);
  expect(offenders).toEqual([]);
});

test("a ranked hit is composed one way", () => {
  // `search_code` and `search_dependency_code` both rank source by relevance.
  // They rendered it as `=== 1 · file · relevance 100% ===` and `1. 100% ·
  // file`, each locally sensible and mutually contradictory.
  const ranked = everything.filter(([, source]) => /\$\w+\.relevance/.test(source));
  const shapes = new Set(
    ranked.map(([, source]) => {
      const [line = ""] = source.split("\n").filter((text) => text.includes(".relevance"));
      return line.replace(/\$\w+\./g, "$.").trim();
    }),
  );
  expect(shapes.size, `ranked hits are written ${shapes.size} different ways`).toBe(1);
});
