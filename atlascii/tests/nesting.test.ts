import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vite-plus/test";
import { functions, render, tags } from "../src/document/index.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

const outline = [
  {
    name: "createTypeAtlas",
    children: [
      { name: "ask", children: [{ name: "sendRequest", notes: ["operations.ts:127"] }] },
      { name: "callHierarchy" },
    ],
  },
  { name: "render" },
];

test("takes the tree a caller already has, to any depth", () => {
  // Depth is a property of where a row sits. A caller that had to flatten its
  // outline and count levels was doing the component's arithmetic for it.
  expect(compose(`{% tree entries=$entries /%}`, { entries: outline })).toMatchInlineSnapshot(`
    "createTypeAtlas
    ├  ask
    │  └  sendRequest operations.ts:127
    └  callHierarchy
    render"
  `);
});

test("draws one set of entries three ways, changing only the guide", () => {
  // The style axis of the design language. Same data, same composed labels,
  // three presentations — so a consumer picks one for every tool at once and
  // no document has to agree to it. This is what makes the choice a setting
  // rather than a habit each document forms on its own.
  const drawn = (guide: string) =>
    compose(`{% tree entries=$entries guide="${guide}" /%}`, { entries: outline });
  expect(drawn("indent")).toMatchInlineSnapshot(`
    "createTypeAtlas
      ask
        sendRequest operations.ts:127
      callHierarchy
    render"
  `);
  expect(drawn("markers")).toMatchInlineSnapshot(`
    "createTypeAtlas
      ↳ ask
        · sendRequest operations.ts:127
      ↳ callHierarchy
    render"
  `);
  expect(drawn("connectors")).toBe(compose(`{% tree entries=$entries /%}`, { entries: outline }));
});

test("keeps a row's own marker under every guide, because it is not depth", () => {
  // The line between style and meaning. A guide says how deep; `✓` and `□` say
  // what happened, which is a fact about the row and survives whichever guide
  // draws the depth around it. Encoding depth in this field instead is how a
  // caller ends up with a presentation nothing can change.
  const states = [
    {
      marker: "✓",
      name: "src/index.ts",
      notes: ["(5 tests | 2 skipped)", "12ms"],
      children: [
        { marker: "✓", name: "passing case", notes: ["3ms"] },
        { marker: "□", name: "pending case", notes: [null, ""] },
      ],
    },
  ];
  expect(compose(`{% tree entries=$entries /%}`, { entries: states })).toMatchInlineSnapshot(`
    "✓ src/index.ts (5 tests | 2 skipped) 12ms
    ├  ✓ passing case 3ms
    └  □ pending case"
  `);
  expect(compose(`{% tree entries=$entries guide="indent" /%}`, { entries: states }))
    .toMatchInlineSnapshot(`
    "✓ src/index.ts (5 tests | 2 skipped) 12ms
      ✓ passing case 3ms
      □ pending case"
  `);
});

test("nests a selection chain, which is a tree one branch wide", () => {
  expect(
    compose(`{% tree entries=$entries /%}`, {
      entries: [
        {
          name: "12:7",
          children: [
            {
              name: "12:7-12:18",
              children: [{ name: "12:1-18:2", children: [{ name: "1:1-40:1" }] }],
            },
          ],
        },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "12:7
    └  12:7-12:18
       └  12:1-18:2
          └  1:1-40:1"
  `);
});

test("indents a wrapped label at the root, where no guide draws anything", () => {
  // A multi-line value in a flat list is the common case — a type signature
  // spanning four lines is what `list_module_exports` mostly returns. Every
  // depth but the root already distinguishes a continuation from a sibling,
  // because the guide draws something there. At the root it draws nothing, so
  // an unindented continuation reads as the next entry.
  // The continuation carries no leading space of its own, or the assertion
  // below would pass on the label's own text rather than on the guide's doing.
  const wrapped = [
    { name: "hierarchy: (input: {\nbranches: Branch[];\n}) => string[]" },
    { name: "indentGuide: (width?: number) => Guide" },
  ];
  for (const guide of ["connectors", "indent", "markers"]) {
    const drawn = compose(`{% tree entries=$entries guide="${guide}" /%}`, { entries: wrapped });
    const [, continued] = drawn.split("\n");
    expect(continued, `${guide} left a continuation at column zero`).toMatch(/^ +\S/);
  }
});

test("keeps a flat list flat when there is no nesting to show", () => {
  // Every guide draws nothing at depth zero, so a list that never nests reads
  // the same under all three — which is what lets one setting serve a tool
  // that nests and a tool that does not.
  for (const guide of ["connectors", "indent", "markers"]) {
    expect(
      compose(`{% tree entries=$entries guide="${guide}" /%}`, {
        entries: [{ name: "one" }, { name: "two" }],
      }),
    ).toBe("one\ntwo");
  }
});
