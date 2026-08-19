import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vitest";
import { functions, render, renderDocument, tags } from "../src/document/index.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

test("carries the branch through depth, which indentation alone cannot", () => {
  expect(
    compose(`{% tree entries=$entries /%}`, {
      entries: [
        {
          name: "createTypeAtlas",
          children: [
            { name: "ask", children: [{ name: "getTextDocument" }] },
            { name: "callHierarchy", children: [{ name: "sendRequest" }] },
          ],
        },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "createTypeAtlas
    ├  ask
    │  └  getTextDocument
    └  callHierarchy
       └  sendRequest"
  `);
});

test("keeps a deep node inside the branch it belongs to", () => {
  // The vertical bar continues past a node whose parent has later siblings —
  // this is the case a depth-only indent gets wrong.
  expect(
    compose(`{% tree entries=$entries /%}`, {
      entries: [
        {
          name: "app.tsx",
          children: [
            {
              name: "runtime",
              children: [{ name: "openMotionRuntime" }, { name: "closeMotionRuntime" }],
            },
            { name: "render" },
          ],
        },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "app.tsx
    ├  runtime
    │  ├  openMotionRuntime
    │  └  closeMotionRuntime
    └  render"
  `);
});

test("renders several roots without inventing a parent for them", () => {
  expect(
    compose(`{% tree entries=$entries /%}`, {
      entries: [{ name: "core" }, { name: "mcp", children: [{ name: "tools" }] }],
    }),
  ).toMatchInlineSnapshot(`
    "core
    mcp
    └  tools"
  `);
});

test("keeps a wrapped label inside its own branch", () => {
  expect(
    compose(`{% tree entries=$entries /%}`, {
      entries: [
        {
          name: "openMotionRuntime",
          children: [{ name: "signature\n(input: Options) => Runtime" }, { name: "next" }],
        },
      ],
    }),
  ).toMatchInlineSnapshot(`
    "openMotionRuntime
    ├  signature
    │  (input: Options) => Runtime
    └  next"
  `);
});

test("shows a signature with its documentation beneath", () => {
  // Composed by markup rather than by a component: the signature leads because
  // it is what a reader came for, and the indent is what says the prose under
  // it belongs to that signature rather than to whatever follows. Both are
  // things `tight` and `indent` already say, so a component saying them again
  // only decided the order on every document's behalf.
  expect(
    compose(
      `{% tight %}
{% $value %}
{% indent %}
{% $docs %}
{% /indent %}
{% /tight %}`,
      {
        value: "const render: (node: RenderableTreeNode) => string",
        docs: "Flattens a component tree to text.\nThe renderer Markdoc lacks.",
      },
    ),
  ).toMatchInlineSnapshot(`
    "const render: (node: RenderableTreeNode) => string
      Flattens a component tree to text.
      The renderer Markdoc lacks."
  `);
});

test("lists a module's surface with the kind first", () => {
  // The kind leads because a reader scanning for "the types" or "the functions"
  // is scanning that column — the opposite order to an outline, where the name
  // is what identifies the row. Which order that is belongs to the document
  // composing the line, not to a component that decided it once for everyone.
  expect(
    renderDocument({
      source: `{% tree entries=$items partial="module-export.mdoc" /%}`,
      file: "exports.test.mdoc",
      variables: {
        items: [
          { kind: "function", name: "render", signature: "(node) => string" },
          { kind: "type", name: "TreeNode" },
          { kind: "function", name: "padSummaryTitle", deprecated: true },
        ],
      },
      partials: {
        "module-export.mdoc": `{% if $node.kind %}{% $node.kind %} {% /if %}{% $node.name %}{% if $node.deprecated %} [deprecated]{% /if %}{% if $node.signature %}: {% $node.signature %}{% /if %}`,
      },
    }).text,
  ).toMatchInlineSnapshot(`
    "function render: (node) => string
    type TreeNode
    function padSummaryTitle [deprecated]"
  `);
});

test("renders nothing for an empty tree, leaving the document to say so", () => {
  expect(compose(`{% tree entries=$entries /%}`, { entries: [] })).toBe("");
});

test("renders nothing when a document names a collection nobody passed", () => {
  // A document reading a value nobody supplied renders an empty space and says
  // nothing about it; the renderer reports the name separately. Crashing the
  // whole tool over a typo is not that contract.
  expect(compose(`{% tree entries=$absent /%}`)).toBe("");
  expect(compose(`{% rows entries=$absent /%}`)).toBe("");
  expect(compose(`{% each items=$absent as="item" partial="row.mdoc" /%}`)).toBe("");
  expect(compose(`{% sections items=$absent /%}`)).toBe("");
});
