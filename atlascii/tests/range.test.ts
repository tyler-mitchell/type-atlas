import { expect, test } from "vite-plus/test";
import { positionText, rangeText, sameRange } from "../src/protocol/range.ts";

const at = (line: number, character: number) => ({ line, character });
const span = (sl: number, sc: number, el: number, ec: number) => ({
  start: at(sl, sc),
  end: at(el, ec),
});

test("renders a protocol position as a source location", () => {
  // The protocol counts from zero; a source location is read from one.
  expect(positionText(at(0, 0))).toMatchInlineSnapshot(`"1:1"`);
  expect(positionText(at(45, 13))).toMatchInlineSnapshot(`"46:14"`);
});

test("renders a range as its two ends", () => {
  expect(rangeText(span(45, 13, 45, 27))).toMatchInlineSnapshot(`"46:14-46:28"`);
});

test("recognises two ranges covering the same span", () => {
  expect(sameRange(span(1, 2, 3, 4), span(1, 2, 3, 4))).toBe(true);
});

test("distinguishes ranges that differ only at their end", () => {
  // Compared as numbers rather than as rendered text: comparing the strings
  // worked only while both sides used the same formatter.
  expect(sameRange(span(1, 2, 3, 4), span(1, 2, 3, 5))).toBe(false);
});
