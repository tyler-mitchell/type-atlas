import { expect, test } from "vitest";
import { changes } from "../src/components/changes.ts";
import { frames, locationLinks } from "../src/components/location-links.ts";
import { asciiFigures, figures } from "../src/config/figures.ts";
import { asciiMarks } from "../src/config/marks.ts";
import { rowBranches } from "../src/layout/rows.ts";
import { connectorGuide, connectorParts, hierarchy } from "../src/layout/hierarchy.ts";
import { width } from "../src/text/width.ts";

const span = { start: { line: 87, character: 13 }, end: { line: 87, character: 31 } };

test("renders the same content in a set a terminal can display", () => {
  // Mojibake is worse than a hyphen. A transcript piped through a tool that
  // mangles UTF-8 still needs to be readable.
  expect(locationLinks({ items: [{ file: "src/app.ts", selection: span }] })).toEqual([
    "❯ src/app.ts:88:14-88:32",
  ]);
  expect(
    locationLinks({
      items: [{ file: "src/app.ts", selection: span }],
      config: { figures: asciiFigures },
    }),
  ).toEqual(["> src/app.ts:88:14-88:32"]);
});

test("carries the glyph set through a nested component", () => {
  expect(
    changes({
      groups: [{ title: "Added", files: [{ path: "src/a.ts", keys: ["one"] }] }],
      config: { figures: asciiFigures },
    })[0]?.join("\n"),
  ).toMatchInlineSnapshot(`
    "Added
      \\ src/a.ts
        * one"
  `);
});

test("keeps stack frames legible without Unicode", () => {
  expect(
    frames({
      stack: [{ name: "openMotionRuntime", file: "src/app.ts", line: 88, character: 14 }],
      config: { figures: asciiFigures },
    }),
  ).toEqual(["> openMotionRuntime src/app.ts:88:14"]);
});

test("draws a tree with either connector set at the same width", () => {
  // Alignment is computed against glyph width, so a set whose connectors were
  // a different width would shift every row that follows.
  const branches = [{ label: "root", children: [{ label: "child" }] }];
  const unicode = hierarchy({ branches, guide: connectorGuide() });
  const ascii = hierarchy({
    branches,
    guide: connectorGuide(connectorParts(asciiFigures)),
  });
  expect(ascii.join("\n")).toMatchInlineSnapshot(`
    "root
    \`- child"
  `);
  expect(unicode.map(width)).toEqual(ascii.map(width));
});

test("draws a nested outline with either connector set", () => {
  const outline = [
    {
      name: "createTypeAtlas",
      kind: "function",
      fields: ["88:14-88:32"],
      children: [
        {
          name: "ask",
          kind: "function",
          fields: ["88:14-88:32"],
          children: [{ name: "sendRequest", kind: "method", fields: ["88:14-88:32"] }],
        },
        { name: "dispose", kind: "function", fields: ["88:14-88:32"] },
      ],
    },
  ];
  const drawn = (config?: { figures: typeof asciiFigures }) =>
    hierarchy({
      branches: rowBranches(outline, config),
      guide: connectorGuide(connectorParts(config?.figures)),
    });
  expect(drawn({ figures: asciiFigures }).join("\n")).toMatchInlineSnapshot(`
    "createTypeAtlas [function] · 88:14-88:32
    |- ask [function] · 88:14-88:32
    |  \`- sendRequest [method] · 88:14-88:32
    \`- dispose [function] · 88:14-88:32"
  `);
  expect(drawn().map(width)).toEqual(drawn({ figures: asciiFigures }).map(width));
});

test("holds every connector part to one column count", () => {
  // A row's prefix is built from these four, so any difference between them
  // shifts every line that uses the odd one out. They must agree by glyph
  // count, not only by measured width: box drawing is East Asian *Ambiguous*,
  // so `├──` is three columns beside a narrow font and six beside a wide one
  // while `│  ` is three and four — the arms diverge exactly where a reader
  // with a CJK font is looking.
  for (const set of [figures, asciiFigures]) {
    const parts = connectorParts(set);
    // Only the ambiguous glyphs matter. ASCII resolves to one column in every
    // terminal, so a part built from it can hold as many as it likes; a part
    // built from box drawing cannot, because each one doubles where the other
    // set stays put.
    const ambiguous = Object.values(parts).map(
      (part) => [...part].filter((glyph) => glyph.codePointAt(0)! > 0x7f).length,
    );
    expect(new Set(Object.values(parts).map(width)).size, "measured widths differ").toBe(1);
    expect(Math.max(...ambiguous), "a part carries more than one ambiguous glyph").toBeLessThan(2);
  }
});

test("every glyph in the ascii set is ascii", () => {
  const glyphs = Object.entries(asciiFigures);
  expect(glyphs.length).toBeGreaterThan(10);
  expect(glyphs.filter(([, glyph]) => !/^[\x20-\x7E]*$/u.test(glyph))).toEqual([]);
});

test("every mark in the ascii set is ascii", () => {
  const entries = Object.entries(asciiMarks);
  expect(entries.length).toBeGreaterThan(10);
  expect(entries.filter(([, mark]) => !/^[\x20-\x7E]*$/u.test(mark))).toEqual([]);
});

test("keeps every glyph the same width across both sets", () => {
  // A caller measuring a column against one set must get the same answer from
  // the other, or alignment breaks when a consumer switches.
  const differing = (Object.keys(figures) as (keyof typeof figures)[]).filter(
    (name) => width(figures[name]) !== width(asciiFigures[name]),
  );
  expect(differing).toEqual([]);
});
