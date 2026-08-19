import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vitest";
import { functions, render, tags } from "../src/document/index.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

test("stacks frames innermost first", () => {
  expect(
    compose(`{% frames stack=$stack /%}`, {
      stack: [
        { name: "source", file: "src/source.ts", line: 3, character: 9 },
        { file: "test/example.test.ts", line: 6, character: 9 },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "❯ source src/source.ts:3:9
    ❯ test/example.test.ts:6:9"
  `);
});

test("returns a breadcrumb as a value, because it is one", () => {
  // A single line that belongs inside a sentence or an attribute — not a block,
  // so not a tag.
  expect(
    compose(`{% breadcrumb($crumb) %}`, {
      crumb: { kind: "stdout", file: "console.test.ts", path: ["suite", "nested suite"] },
    }),
  ).toMatchInlineSnapshot(`"stdout | console.test.ts > suite > nested suite"`);
});

test("drops the kind when a document names none", () => {
  expect(compose(`{% breadcrumb($crumb) %}`, { crumb: { file: "src/a.ts", path: ["outer"] } })).toBe(
    "src/a.ts > outer",
  );
});

test("indents rows by depth and carries only facts that apply", () => {
  expect(
    compose(`{% tree entries=$entries /%}`, {
      entries: [
        {
          marker: "✓",
          name: "src/index.ts",
          notes: ["(5 tests | 2 skipped)", "12ms"],
          children: [
            { marker: "✓", name: "passing case", notes: ["3ms"] },
            { marker: "□", name: "pending case", notes: [null, ""] },
          ],
        },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "✓ src/index.ts (5 tests | 2 skipped) 12ms
    ├  ✓ passing case 3ms
    └  □ pending case"
  `);
});

test("keeps an authored list's markers, which a stack must not borrow", () => {
  // Components stack lines with `br`; a list means a list.
  expect(compose(`- one\n- two\n`)).toMatchInlineSnapshot(`
    "- one
    - two"
  `);
});

test("composes migrated components into one report", () => {
  const document = `
{% section title="Callers" %}
{% frames stack=$stack /%}
{% /section %}

{% section title="Outline" level=3 %}
{% tree entries=$entries /%}
{% /section %}
`;
  expect(
    compose(document, {
      stack: [{ name: "renderDocument", file: "src/markdoc/render.ts", line: 57, character: 14 }],
      entries: [
        {
          name: "createTypeAtlas",
          notes: ["118:14-118:29"],
          children: [{ name: "ask" }],
        },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "## Callers

    ❯ renderDocument src/markdoc/render.ts:57:14

    ### Outline

    createTypeAtlas 118:14-118:29
    └  ask"
  `);
});
