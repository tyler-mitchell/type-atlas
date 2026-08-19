import { expect, test } from "vitest";
import { visibleTrailingSpace } from "../src/text/whitespace.ts";

test("makes trailing whitespace visible, one dot per character", () => {
  // A difference that is only trailing whitespace otherwise renders as two
  // identical-looking lines, and a reader concludes the tool is broken.
  expect(visibleTrailingSpace({ text: "value  " })).toMatchInlineSnapshot(`"value··"`);
});

test("marks trailing whitespace on every line of a value", () => {
  expect(visibleTrailingSpace({ text: "first \nsecond   \nthird" })).toMatchInlineSnapshot(`
    "first·
    second···
    third"
  `);
});
