import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vite-plus/test";
import { functions, render, tags } from "../src/document/index.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

test("lists files under what happened to them, with keys beneath each", () => {
  expect(
    compose(`{% changes groups=$groups /%}`, {
      groups: [
        {
          title: "Added",
          files: [{ path: "src/render.ts", keys: ["renders a list", "renders a heading"] }],
        },
        { title: "Removed", files: [{ path: "src/node.ts" }] },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "Added
      ↳ src/render.ts
        · renders a list
        · renders a heading

    Removed
      ↳ src/node.ts"
  `);
});

test("leaves out a group that nothing happened to", () => {
  // The same rule a count line follows: never print a zero.
  expect(
    compose(`{% changes groups=$groups /%}`, {
      groups: [
        { title: "Added", files: [] },
        { title: "Updated", files: [{ path: "src/tags.ts" }] },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "Updated
      ↳ src/tags.ts"
  `);
});

test("renders nothing when nothing changed", () => {
  expect(
    compose(`{% changes groups=$groups /%}`, { groups: [{ title: "Added", files: [] }] }),
  ).toBe("");
});
