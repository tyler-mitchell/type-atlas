import { expect, test } from "vite-plus/test";
import { codeFrame } from "../src/source/frame.ts";

const source = `
test("works on macos", () => {
  expect(process.env.TEST_LABEL_ENV === 'macos').toBe(true)
})
`;

test("points a caret at the column it is given", () => {
  expect(codeFrame({ source, line: 3, character: 50 })).toMatchInlineSnapshot(`
    "  1 |
      2 | test("works on macos", () => {
      3 |   expect(process.env.TEST_LABEL_ENV === 'macos').toBe(true)
        |                                                  ^
      4 | })
      5 |"
  `);
});

test("holds the caret steady when the source uses CRLF", () => {
  // The newline width is two here. Counting it as one drifts the caret by one
  // column per preceding line, which is the whole reason the arithmetic lives
  // in `source-offset.ts` rather than in each component.
  const windows = source.replace(/\n/g, "\r\n");
  expect(codeFrame({ source: windows, line: 3, character: 50 })).toEqual(
    codeFrame({ source, line: 3, character: 50 }),
  );
});

test("counts the first column as one", () => {
  expect(codeFrame({ source: "abcdef\nghijkl\n", line: 1, character: 1, range: 0 }))
    .toMatchInlineSnapshot(`
      "  1 | abcdef
          | ^"
    `);
});

test("underlines a span across its whole extent", () => {
  const declaration = `export const renderDocument = async (input: {\n}) => {};\n`;
  expect(
    codeFrame({
      source: declaration,
      line: 1,
      character: 13,
      end: { line: 1, character: 27 },
      range: 0,
    }),
  ).toMatchInlineSnapshot(`
    "  1 | export const renderDocument = async (input: {
        |             ^^^^^^^^^^^^^^"
  `);
});

test("stops a span at the end of the line it starts on", () => {
  // A caret row belongs to one line, so a span leaving that line underlines to
  // its end rather than running past it.
  const declaration = `export const renderDocument = async (input: {\n}) => {};\n`;
  const spanning = codeFrame({
    source: declaration,
    line: 1,
    character: 13,
    end: { line: 2, character: 2 },
    range: 0,
  });
  expect(spanning.split("\n").at(-1)?.trimEnd().endsWith("^")).toBe(true);
});

test("abandons a frame whose lines are too long to read", () => {
  expect(codeFrame({ source: "x".repeat(201), line: 1, character: 1 })).toBe("");
});
