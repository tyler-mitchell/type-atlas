import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vitest";
import { codeFrame } from "../src/source/frame.ts";
import { functions, render, tags } from "../src/document/index.ts";
import { summary } from "../src/layout/summary.ts";
import { width } from "../src/text/width.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

test("puts the caret under the column even when wide characters precede it", () => {
  // Every character before the caret is two columns. Padding by code units
  // would place the caret at half the distance.
  const source = `const 名前 = "太郎";\n`;
  const frame = codeFrame({ source, line: 1, character: 12, range: 0 });
  const [row, carets] = frame.split("\n");
  expect(carets?.indexOf("^")).toBe(width(row?.slice(0, row.indexOf('"')) ?? ""));
});

test("underlines a wide span by the columns it occupies", () => {
  // Two characters, four columns, so four carets.
  const source = `const x = 東京;\n`;
  const frame = codeFrame({
    source,
    line: 1,
    character: 11,
    end: { line: 1, character: 13 },
    range: 0,
  });
  expect(frame.split("\n")[1]?.match(/\^+/)?.[0]).toBe("^^^^");
});

test("names every severity in the reader's language", () => {
  // The protocol assigns numbers; the words are a reader's. A library that
  // baked English here would be untranslatable at exactly the point a reader
  // most needs to understand it.
  const document = [
    `{% severity value=1 config=$config /%}`,
    `{% severity value=2 config=$config /%}`,
    `{% severity config=$config /%}`,
  ].join(" ");
  expect(
    compose(document, {
      config: {
        messages: {
          "diagnostic.severity.1": "Fehler",
          "diagnostic.severity.2": "Warnung",
          "diagnostic.severity.unknown": "Problem",
        },
      },
    }),
  ).toBe("Fehler Warnung Problem");
});

test("aligns summary labels to the same column across languages", () => {
  // The values must start at the same column whichever label precedes them,
  // which is only true if padding counts columns rather than code units.
  const english = summary({ rows: [{ label: "Tests", value: "8" }] });
  const japanese = summary({ rows: [{ label: "テスト", value: "8" }] });
  expect(width(english.slice(0, english.indexOf("8")))).toBe(
    width(japanese.slice(0, japanese.indexOf("8"))),
  );
});
