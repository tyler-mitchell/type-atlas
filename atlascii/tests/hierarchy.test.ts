import { expect, test } from "vitest";
import { connectorGuide, hierarchy, indentGuide, markerGuide } from "../src/layout/hierarchy.ts";

const branches = [
  {
    label: "src/app.tsx",
    children: [
      { label: "10:3:  openMotionRuntime,", children: [{ label: "deeper" }] },
      { label: "123:30:  const opened = await" },
    ],
  },
  { label: "src/index.ts", children: [{ label: "4:1:  export {" }] },
];

test("draws the same structure three ways, changing only the guide", () => {
  // One traversal, one data shape, depth drawn however a component needs it.
  // Adding a presentation is a guide, not a new component.
  expect({
    indent: hierarchy({ branches, guide: indentGuide() }).join("\n"),
    markers: hierarchy({ branches, guide: markerGuide({ marks: ["↳", "·"] }) }).join("\n"),
    connectors: hierarchy({ branches, guide: connectorGuide() }).join("\n"),
  }).toMatchInlineSnapshot(`
    {
      "connectors": "src/app.tsx
    ├  10:3:  openMotionRuntime,
    │  └  deeper
    └  123:30:  const opened = await
    src/index.ts
    └  4:1:  export {",
      "indent": "src/app.tsx
      10:3:  openMotionRuntime,
        deeper
      123:30:  const opened = await
    src/index.ts
      4:1:  export {",
      "markers": "src/app.tsx
      ↳ 10:3:  openMotionRuntime,
        · deeper
      ↳ 123:30:  const opened = await
    src/index.ts
      ↳ 4:1:  export {",
    }
  `);
});

test("leaves a vertical bar under a parent that has siblings after it", () => {
  // A connector guide has to know, for every ancestor, whether it was last —
  // otherwise it cannot tell a continuing branch from a finished one.
  // The bar belongs to the ancestor and the connector beside it to the child,
  // so the two together are what a continuing branch looks like — a bar alone
  // would also match a row that merely ends with one.
  expect(hierarchy({ branches, guide: connectorGuide() }).join("\n")).toContain("│  └");
});

test("keeps a wrapped label inside its own branch", () => {
  // A label can wrap — a type signature is the common case — and a continuation
  // starting at column zero would read as a sibling.
  expect(
    hierarchy({
      branches: [
        {
          label: "openMotionRuntime",
          children: [{ label: "signature\n(input: Options) => Runtime" }, { label: "next" }],
        },
      ],
      guide: connectorGuide(),
    }).join("\n"),
  ).toMatchInlineSnapshot(`
    "openMotionRuntime
    ├  signature
    │  (input: Options) => Runtime
    └  next"
  `);
});

test("repeats the final marker past the marks it was given", () => {
  expect(
    hierarchy({
      branches: [
        { label: "a", children: [{ label: "b", children: [{ label: "c", children: [{ label: "d" }] }] }] },
      ],
      guide: markerGuide({ marks: ["↳", "·"] }),
    }).join("\n"),
  ).toMatchInlineSnapshot(`
    "a
      ↳ b
        · c
          · d"
  `);
});

test("renders a flat list untouched", () => {
  expect(hierarchy({ branches: [{ label: "one" }, { label: "two" }] })).toEqual(["one", "two"]);
});
