import { expect, test } from "vite-plus/test";
import { diff } from "../src/components/diff.ts";
import type { DiffChunk } from "../src/protocol/shapes.ts";

const body = (chunks: readonly DiffChunk[], context?: number) =>
  (diff({ chunks, context })[1] ?? []).join("\n");

const numbered = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);

test("shows every line when nothing is far from a change", () => {
  expect(
    body([
      { kind: "common", lines: ["a", "b"] },
      { kind: "removed", lines: ["old"] },
      { kind: "added", lines: ["new"] },
      { kind: "common", lines: ["c", "b"] },
    ]),
  ).toMatchInlineSnapshot(`
    "  a
      b
    - old
    + new
      c
      b"
  `);
});

test("leaves out unchanged lines far from any change, and says how many", () => {
  // The reason this exists: without it, two changed lines in a five-hundred
  // line file print five hundred lines, and the answer is buried in evidence.
  expect(
    body([
      { kind: "common", lines: numbered("before", 10) },
      { kind: "removed", lines: ["old"] },
      { kind: "added", lines: ["new"] },
      { kind: "common", lines: numbered("after", 10) },
    ]),
  ).toMatchInlineSnapshot(`
    "@@ 7 unchanged lines
      before8
      before9
      before10
    - old
    + new
      after1
      after2
      after3
    @@ 7 unchanged lines"
  `);
});

test("keeps one run between two changes when both ends reach it", () => {
  // Four common lines with context 3 on each side: every line is within reach
  // of one change or the other, so nothing is dropped and no gap is claimed.
  expect(
    body([
      { kind: "removed", lines: ["first"] },
      { kind: "common", lines: numbered("mid", 4) },
      { kind: "added", lines: ["second"] },
    ]),
  ).toMatchInlineSnapshot(`
    "- first
      mid1
      mid2
      mid3
      mid4
    + second"
  `);
});

test("counts a gap between changes once, not once per side", () => {
  expect(
    body([
      { kind: "removed", lines: ["first"] },
      { kind: "common", lines: numbered("mid", 20) },
      { kind: "added", lines: ["second"] },
    ]),
  ).toContain("@@ 14 unchanged lines");
});

test("says one line, not one lines", () => {
  expect(
    body([
      { kind: "removed", lines: ["old"] },
      { kind: "common", lines: numbered("m", 7) },
      { kind: "added", lines: ["new"] },
    ]),
  ).toContain("@@ 1 unchanged line");
});

test("a diff of only unchanged lines is a gap, not a wall of text", () => {
  expect(body([{ kind: "common", lines: numbered("same", 40) }])).toBe("@@ 40 unchanged lines");
});

test("shows everything when the caller asks for unbounded context", () => {
  const rows = body(
    [
      { kind: "common", lines: numbered("before", 10) },
      { kind: "removed", lines: ["old"] },
    ],
    Number.POSITIVE_INFINITY,
  ).split("\n");
  expect(rows).toHaveLength(11);
  expect(rows).not.toContain(expect.stringContaining("@@"));
});
