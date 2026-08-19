import { expect, test } from "vitest";
import { breadcrumb } from "../src/layout/breadcrumb.ts";
import { codeFrame } from "../src/source/frame.ts";
import { divider } from "../src/layout/divider.ts";
import { width } from "../src/text/width.ts";
import { rows } from "../src/layout/rows.ts";
import { diff } from "../src/components/diff.ts";
import { asciiFigures } from "../src/config/figures.ts";
import { asciiMarks, defaultMarks } from "../src/config/marks.ts";
import { narrowDimensions } from "../src/config/dimensions.ts";
import { type Config, resolve } from "../src/config/index.ts";
import { counts } from "../src/components/counts.ts";

test("falls back per namespace, not all or nothing", () => {
  // Choosing one namespace must not cost the defaults of the other three —
  // a caller who wants ASCII glyphs still wants the default words.
  const resolved = resolve({ figures: asciiFigures });
  expect(resolved.figures).toBe(asciiFigures);
  expect(resolved.marks).toBe(defaultMarks);
  expect(resolved.messages["counts.empty"]).toBe("none");
  expect(resolved.dimensions.labelWidth).toBe(11);
});

test("carries one config through every component that renders words", () => {
  // The point of the container: one object answers for glyphs, punctuation,
  // words, and widths across components that share nothing else.
  const config: Config = {
    marks: { ...asciiMarks, kindOpen: "(", kindClose: ")", diffRemoved: "<", diffAdded: ">" },
    messages: { "diff.expected": "Erwartet", "diff.received": "Erhalten", "counts.empty": "keine" },
    figures: asciiFigures,
    dimensions: narrowDimensions,
  };

  expect(
    rows([{ name: "openRuntime", kind: "function", fields: ["src/a.ts"], detail: "runtime" }], config),
  ).toEqual(["openRuntime (function) - src/a.ts -- runtime"]);

  expect(diff({ chunks: [{ kind: "removed", lines: ["alt"] }], config })).toEqual([
    ["< Erwartet", "> Erhalten"],
    ["< alt"],
  ]);

  expect(counts({ states: [{ name: "failed", count: 0 }], config })).toBe("keine");

  expect(
    rows([{ name: "openRuntime", kind: "function", fields: ["8:3-8:14"] }], config)[0],
  ).toContain("openRuntime (function)");
});

test("reaches the parts of a config a component never names", () => {
  // `codeFrame` takes no words at all, so the only proof its config arrives is
  // the gutter it draws and the width that gutter reserves.
  const framed = codeFrame({
    source: "const runtime = {\n  frames: 60,\n};\n",
    line: 2,
    character: 3,
    config: { marks: { ...defaultMarks, gutter: ">", caret: "~" } },
  });
  expect(framed.split("\n")[1]).toContain(">");
  expect(framed).toContain("~");
});

test("lets the components whose whole subject is a separator change it", () => {
  // A breadcrumb that could not change its own joiner was the sharpest case of
  // the literals this container exists to collect.
  expect(
    breadcrumb({
      kind: "stdout",
      file: "console.test.ts",
      path: ["suite", "nested"],
      config: { marks: { ...defaultMarks, trail: " / ", channel: ": " } },
    }),
  ).toBe("stdout: console.test.ts / suite / nested");

  expect(breadcrumb({ file: "src/a.ts", path: ["openRuntime"] })).toBe("src/a.ts > openRuntime");
});

test("reaches the margin a config names, counting columns not code units", () => {
  // A rule's only job is to reach the margin, so a wide title must not push it
  // past one — the failure `.length` produces is exactly the width it added.
  expect(width(divider({ config: { dimensions: narrowDimensions } }))).toBe(40);
  expect(width(divider({ text: " 東京 ", config: { dimensions: narrowDimensions } }))).toBe(40);
  expect(width(divider())).toBe(80);
});

