import { expect, test } from "vite-plus/test";
import { height, width } from "../src/text/width.ts";

test("counts one row per line that fits", () => {
  expect(height({ value: "one\ntwo\nthree", columns: 80 })).toBe(3);
});

test("an empty line still occupies a row", () => {
  expect(height({ value: "one\n\ntwo", columns: 80 })).toBe(3);
  expect(height({ value: "", columns: 80 })).toBe(1);
});

test("counts the rows a wrapped line actually takes", () => {
  expect(height({ value: "x".repeat(80), columns: 40 })).toBe(2);
  expect(height({ value: "x".repeat(81), columns: 40 })).toBe(3);
});

test("measures in columns, not code units", () => {
  // The reason this is not `text.length / columns`: forty CJK characters are
  // forty code units and eighty columns. Counting units reports one row for a
  // frame that occupies two, and `redraw` then leaves half of it on screen.
  const wide = "名".repeat(40);
  expect(width(wide)).toBe(80);
  expect(height({ value: wide, columns: 80 })).toBe(1);
  expect(height({ value: wide, columns: 40 })).toBe(2);
});

test("falls back to line count when there is no width to wrap at", () => {
  expect(height({ value: "one\ntwo", columns: 0 })).toBe(2);
});
