import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vite-plus/test";
import { narrowDimensions } from "../src/config/dimensions.ts";
import { functions } from "../src/document/functions.ts";
import { labelPrinter } from "../src/layout/label.ts";
import { timeOfDay } from "../src/text/time.ts";
import { render } from "../src/document/render.ts";
import { tags } from "../src/document/tags.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

test("sets a name apart from what follows it", () => {
  expect(compose(`{% label name="node" message="works on macos" /%}`)).toMatchInlineSnapshot(
    `"|node| works on macos"`,
  );
});

test("brackets a bare name when there is no message", () => {
  expect(compose(`{% label name="linux" /%}`)).toBe("|linux|");
});

test("names only the parts that took time", () => {
  expect(
    compose(`{% breakdown parts=$parts /%}`, {
      parts: [
        { name: "transform", milliseconds: 84 },
        { name: "setup", milliseconds: 0 },
        { name: "collect", milliseconds: 1210 },
      ],
    }),
  ).toMatchInlineSnapshot(`"transform 84ms, collect 1.21s"`);
});

test("gives the ordinal form of a number, by the locale's rules", () => {
  // English forms are supplied by the caller rather than assumed by the
  // library, which is what lets any other language supply its own.
  const document = [1, 2, 3, 11, 21]
    .map((count) => `{% plural count=${count} forms=$english type="ordinal" /%}`)
    .join(" ");
  expect(
    compose(document, {
      english: { one: "{count}st", two: "{count}nd", few: "{count}rd", other: "{count}th" },
    }),
  ).toBe("1st 2nd 3rd 11th 21st");
});

test("counts in a language with more than two plural forms", () => {
  expect(
    compose(`{% plural count=5 forms=$polish locale="pl" /%}`, {
      polish: {
        one: "{count} odwołanie",
        few: "{count} odwołania",
        many: "{count} odwołań",
        other: "{count} odwołania",
      },
    }),
  ).toBe("5 odwołań");
});

test("normalises a path's separators", () => {
  expect(compose(`{% slash($path) %}`, { path: "src\\app\\index.ts" })).toBe("src/app/index.ts");
});

test("sizes each column to its widest cell", () => {
  expect(
    compose(`{% table columns=$columns rows=$rows /%}`, {
      columns: [
        { heading: "symbol" },
        { heading: "kind" },
        { heading: "references", align: "end" },
      ],
      rows: [
        ["createTypeAtlas", "function", "12"],
        ["render", "function", "4"],
        ["positionToOffset", "function", "137"],
      ],
    }),
  ).toMatchInlineSnapshot(`
    "symbol            kind      references
    createTypeAtlas   function          12
    render            function           4
    positionToOffset  function         137"
  `);
});

test("sizes columns by terminal width, so any script lines up", () => {
  expect(
    compose(`{% table columns=$columns rows=$rows /%}`, {
      columns: [{ heading: "name" }, { heading: "count", align: "end" }],
      rows: [
        ["東京", "2"],
        ["ab", "10"],
      ],
    }),
  ).toMatchInlineSnapshot(`
    "name  count
    東京      2
    ab       10"
  `);
});

test("centres a rule's name within it", () => {
  expect(
    compose(`{% divider text=" Failed Tests 2 " config=$config /%}`, {
      config: { dimensions: narrowDimensions },
    }),
  ).toMatchInlineSnapshot(`"⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯"`);
});

test("aligns a set of labels chosen at runtime", () => {
  // The width comes from the longest label given, which a fixed column cannot do.
  const print = labelPrinter(["Expected", "Received"]);
  expect(`${print("Expected")}true\n${print("Received")}false`).toMatchInlineSnapshot(`
    "Expected: true
    Received: false"
  `);
});

test("reads the clock time of a moment without its date", () => {
  expect(timeOfDay(new Date(2026, 0, 1, 9, 4, 5))).toBe("09:04:05");
});
