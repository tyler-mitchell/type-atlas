import { expect, test } from "vitest";
import { renderDocument } from "../src/document/index.ts";

// Located rows grouped under their file used to be a component. The grouping,
// the row's fields, and which of them appear are now written in a document —
// what stays here is the nesting itself, which markup cannot carry because
// Markdown owns leading whitespace.
const group = `{% tight %}
{% $group.file %}
{% indent %}
{% each items=$group.rows as="row" partial="row.mdoc" tight=true /%}
{% /indent %}
{% /tight %}`;

const row = `{% if $row.name %}{% $row.name %}{% if $row.kind %} [{% $row.kind %}]{% /if %} · {% /if %}{% range($row.selection) %}{% if $row.extent %} · range {% range($row.extent) %}{% /if %}{% if $row.within %} · inside {% $row.within %}{% /if %}{% if $row.detail %} — {% $row.detail %}{% /if %}{% if $row.text %}:  {% $row.text %}{% /if %}`;

const compose = (variables: Record<string, unknown>) =>
  renderDocument({
    source: `{% each items=$groups as="group" partial="group.mdoc" /%}`,
    file: "locations.test.mdoc",
    variables,
    partials: { "group.mdoc": group, "row.mdoc": row },
  }).text;

const span = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

test("indents rows under the file that holds them", () => {
  expect(
    compose({
      groups: [
        {
          file: "src/app.ts",
          rows: [{ selection: span(9, 2, 9, 6), text: "openMotionRuntime," }],
        },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "src/app.ts
      10:3-10:7:  openMotionRuntime,"
  `);
});

test("carries every fact a row has, and none it does not", () => {
  expect(
    compose({
      groups: [
        {
          file: "src/app.ts",
          rows: [
            {
              name: "ask",
              kind: "method",
              selection: span(11, 4, 11, 7),
              extent: span(11, 0, 14, 1),
              within: "createTypeAtlas",
              detail: "() => void",
            },
            { selection: span(20, 2, 20, 6) },
          ],
        },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "src/app.ts
      ask [method] · 12:5-12:8 · range 12:1-15:2 · inside createTypeAtlas — () => void
      21:3-21:7"
  `);
});

test("separates one file's rows from the next", () => {
  expect(
    compose({
      groups: [
        { file: "src/a.ts", rows: [{ selection: span(0, 0, 0, 1) }] },
        { file: "src/b.ts", rows: [{ selection: span(4, 0, 4, 1) }] },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "src/a.ts
      1:1-1:2

    src/b.ts
      5:1-5:2"
  `);
});
