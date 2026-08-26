import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import { findOccurrenceCandidates } from "../src/occurrence-candidates.ts";

test("ast-grep finds identifiers without comments or strings", async () => {
  const root = await mkdtemp(join(tmpdir(), "type-atlas-occurrence-candidates-"));
  try {
    const typescript = join(root, "unicode.ts");
    const tsx = join(root, "panel.tsx");
    const javascript = join(root, "helper.js");
    await writeFile(
      typescript,
      [
        "const π = 1;",
        "class Box { #secret = π; read() { return this.#secret; } }",
        'const text = "π"; // π',
        "const admission = [1, 2];",
        "const d = { u32: (value: number) => value };",
        "const first = admission[d.u32(0)];",
        "const spaced = admission [ d.u32(0) ];",
        "const other = admission[d.u32(1)];",
        'const expressionText = "admission[d.u32(0)]"; // admission[d.u32(0)]',
        "",
      ].join("\n"),
    );
    await writeFile(tsx, "const Panel = () => <Panel />;\n");
    await writeFile(javascript, "const helper = () => helper;\n");

    const query = () =>
      findOccurrenceCandidates({
        root,
        queries: ["π", "#secret", "Panel", "helper", "admission[d.u32(0)]"],
        files: [typescript, tsx, javascript],
        signal: new AbortController().signal,
      });
    const [found, concurrent] = await Promise.all([query(), query()]);
    const summary = (candidates: typeof found) =>
      candidates.map(({ query, kind, total }) => [query, kind, total]);
    const expected = [
      ["π", "identifier", 2],
      ["#secret", "identifier", 2],
      ["Panel", "identifier", 2],
      ["helper", "identifier", 2],
      ["admission[d.u32(0)]", "expression", 2],
    ];
    expect(summary(found)).toEqual(expected);
    expect(summary(concurrent)).toEqual(expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
