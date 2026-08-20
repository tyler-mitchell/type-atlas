import { expect, test } from "vite-plus/test";
import { padStart, truncate, width } from "../src/text/width.ts";

test("counts an ASCII string by its characters", () => {
  expect(width("error")).toBe(5);
});

test("counts East Asian characters as two columns each", () => {
  // Two code units, four columns. Using length here misaligns every column
  // that follows it.
  expect("東京".length).toBe(2);
  expect(width("東京")).toBe(4);
});

test("counts a combining mark as no column at all", () => {
  const decomposed = "é";
  expect(decomposed.length).toBe(2);
  expect(width(decomposed)).toBe(1);
});

test("counts a joined emoji as one grapheme of two columns", () => {
  const developer = "👩‍💻";
  expect(developer.length).toBeGreaterThan(2);
  expect(width(developer)).toBe(2);
});

test("pads to a column count rather than a code-unit count", () => {
  // Both labels must reach the same column, or the values beside them will not
  // line up for a reader in either language.
  expect(padStart({ value: "Tests", columns: 11 })).toHaveLength(11);
  expect(width(padStart({ value: "テスト", columns: 11 }))).toBe(11);
});

test("cuts to a column count without splitting a grapheme", () => {
  // Slicing by index would strand half a surrogate pair here.
  const cut = truncate({ value: "👩‍💻👩‍💻👩‍💻", columns: 5 });
  expect(width(cut)).toBeLessThanOrEqual(5);
  expect(cut.endsWith("…")).toBe(true);
});

test("leaves a string that already fits untouched", () => {
  expect(truncate({ value: "short", columns: 20 })).toBe("short");
});
