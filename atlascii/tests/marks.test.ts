import { expect, test } from "vitest";
import { asciiMarks, defaultMarks } from "../src/config/marks.ts";
import { rows } from "../src/layout/rows.ts";
import { counts } from "../src/components/counts.ts";

const span = { start: { line: 87, character: 13 }, end: { line: 87, character: 31 } };

test("joins fields with the punctuation a caller chose", () => {
  // The literals were scattered across a dozen components, where the set was
  // neither visible nor changeable.
  const entry = {
    name: "openMotionRuntime",
    kind: "function",
    fields: ["src/app.ts:88:14-88:32"],
    detail: "runtime",
  };
  expect(rows([entry])).toEqual([
    "openMotionRuntime [function] · src/app.ts:88:14-88:32 — runtime",
  ]);
  expect(
    rows([entry], { marks: { ...defaultMarks, kindOpen: "(", kindClose: ")", detail: " in " } }),
  ).toEqual(["openMotionRuntime (function) · src/app.ts:88:14-88:32 in runtime"]);
});

test("keeps output ASCII when a consumer needs it", () => {
  // The em dash and the middle dot are the only non-ASCII marks here, so
  // `asciiMarks` changes those two and leaves the rest alone.
  expect(
    rows([{ name: "a", kind: "function", fields: ["b.ts"], detail: "c" }], { marks: asciiMarks }),
  ).toEqual(["a [function] - b.ts -- c"]);
});

test("joins a row's separately meaningful fields by a chosen separator", () => {
  expect(
    rows(
      [{ name: "openRuntime", fields: ["src/a.ts:10:3", "inside runtime"] }],
      { marks: { ...defaultMarks, separator: " | " } },
    ),
  ).toEqual(["openRuntime | src/a.ts:10:3 | inside runtime"]);
});

test("joins counted states and brackets a total by the marks", () => {
  expect(
    counts({
      states: [{ name: "failed", count: 2 }, { name: "passed", count: 6 }],
      total: 8,
      config: { marks: { ...defaultMarks, countJoin: " / ", totalOpen: " [", totalClose: "]" } },
    }),
  ).toBe("2 failed / 6 passed [8]");
});
