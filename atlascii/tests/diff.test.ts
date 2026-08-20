import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vite-plus/test";
import { defaultMarks } from "../src/config/marks.ts";
import { functions, render, tags } from "../src/document/index.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

test("heads the block with what each marker means", () => {
  expect(
    compose(`{% diff chunks=$chunks /%}`, {
      chunks: [
        { kind: "removed", lines: ["true"] },
        { kind: "added", lines: ["false"] },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "- Expected
    + Received

    - true
    + false"
  `);
});

test("keeps common lines beside the changed ones", () => {
  expect(
    compose(`{% diff chunks=$chunks /%}`, {
      chunks: [
        { kind: "common", lines: ["const runtime = {"] },
        { kind: "removed", lines: ["  frames: 60,"] },
        { kind: "added", lines: ["  frames: 120,"] },
        { kind: "common", lines: ["};"] },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "- Expected
    + Received

      const runtime = {
    -   frames: 60,
    +   frames: 120,
      };"
  `);
});

test("lets a document name both sides and both markers", () => {
  // The markers are conventions and the annotations are words; neither belongs
  // to the library.
  expect(
    compose(`{% diff chunks=$chunks config=$config /%}`, {
      chunks: [
        { kind: "removed", lines: ["alt"] },
        { kind: "added", lines: ["neu"] },
      ],
      config: {
        marks: { ...defaultMarks, diffRemoved: "<", diffAdded: ">" },
        messages: { "diff.expected": "Erwartet", "diff.received": "Erhalten" },
      },
    }),
  ).toMatchInlineSnapshot(`
    "< Erwartet
    > Erhalten

    < alt
    > neu"
  `);
});

test("renders nothing when there is no difference", () => {
  expect(compose(`{% diff chunks=$chunks /%}`, { chunks: [] })).toBe("");
});

test("sits inside a section like any other component", () => {
  expect(
    compose(`{% section title="Changed" %}\n{% diff chunks=$chunks /%}\n{% /section %}`, {
      chunks: [
        { kind: "removed", lines: ["a"] },
        { kind: "added", lines: ["b"] },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "## Changed

    - Expected
    + Received

    - a
    + b"
  `);
});

test("groups problems under the file holding them", () => {
  // Repeating a path on every row costs more than it tells.
  expect(
    compose(`{% diagnostics problems=$problems /%}`, {
      problems: [
        {
          file: "src/a.ts",
          severity: 1,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "first",
        },
        {
          file: "src/a.ts",
          severity: 2,
          range: { start: { line: 4, character: 2 }, end: { line: 4, character: 3 } },
          message: "second",
        },
        {
          file: "src/b.ts",
          severity: 1,
          range: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } },
          message: "third",
        },
      ],
    }),
  ).toMatchInlineSnapshot(`""`);
});
