import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vite-plus/test";
import { functions, render, tags } from "../src/document/index.ts";

// Composing a file view — its heading, its extent, whether it is one file or
// several — belongs to `read-file.tool.mdoc` and is tested there. What stays
// here is the one part a document cannot express: numbering lines, aligning
// the gutter to the widest number, and folding bodies away.
const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`);

test("numbers lines from one, since a reader counts from one", () => {
  expect(compose(`{% source lines=$lines /%}`, { lines: ["a", "b"] })).toBe("1 | a\n2 | b");
});

test("aligns the gutter to the widest number, so code keeps a straight edge", () => {
  const text = compose(`{% source lines=$lines /%}`, { lines: lines(10) });
  expect(text.split("\n").at(0)).toBe(" 1 | line 1");
  expect(text.split("\n").at(-1)).toBe("10 | line 10");
});

test("shows only the span asked for, numbered where it actually sits", () => {
  expect(compose(`{% source lines=$lines from=3 to=4 /%}`, { lines: lines(9) })).toBe(
    "3 | line 3\n4 | line 4",
  );
});

test("numbers a snippet by the line it was cut from", () => {
  expect(compose(`{% source lines=$lines startLine=87 /%}`, { lines: ["a", "b"] })).toBe(
    "87 | a\n88 | b",
  );
});

test("renders nothing for no lines, leaving the document to say so", () => {
  expect(compose(`{% source lines=$lines /%}`, { lines: [] })).toBe("");
});
