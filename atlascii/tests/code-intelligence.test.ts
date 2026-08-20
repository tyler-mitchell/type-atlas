import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vite-plus/test";
import { functions, render, renderDocument, tags } from "../src/document/index.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

const span = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

test("points at a target, naming an extent only when it was given one", () => {
  // Whether an extent differs from the selection is decided where the two are
  // known; the document states what it was handed. Repeating an identifier's
  // own span costs a second read to learn nothing, so the absent case is the
  // common one.
  expect(
    renderDocument({
      source: `{% each items=$items as="target" partial="target.mdoc" tight=true /%}`,
      file: "targets.test.mdoc",
      variables: {
        items: [
          { file: "src/render.ts", selection: span(56, 13, 56, 27), extent: span(56, 0, 70, 2) },
          { file: "src/index.ts", selection: span(31, 9, 31, 23) },
        ],
      },
      partials: {
        "target.mdoc": `{% figure("pointer") %} {% if $target.name %}{% $target.name %} · {% /if %}{% $target.file %}:{% range($target.selection) %}{% if $target.extent %} · range {% range($target.extent) %}{% /if %}`,
      },
    }).text,
  ).toMatchInlineSnapshot(`
    "❯ src/render.ts:57:14-57:28 · range 57:1-71:3
    ❯ src/index.ts:32:10-32:24"
  `);
});

test("connects callables to the file that holds them, the line composed by markup", () => {
  // Connectors are the one thing a document cannot draw: which prefix a node
  // takes depends on its position among its siblings and on which ancestors are
  // still open. What the node says is a partial's business.
  expect(
    renderDocument({
      source: `{% tree entries=$groups partial="call-node.mdoc" /%}`,
      file: "calls.test.mdoc",
      variables: {
        groups: [
          {
            file: "src/navigation.tools.ts",
            children: [
              {
                name: "renderDocument",
                kind: "function",
                selection: span(56, 13, 56, 27),
                extent: span(56, 30, 70, 1),
                sites: ["642:30-642:44", "676:30-676:44"],
              },
            ],
          },
        ],
      },
      partials: {
        "call-node.mdoc": `{% if $node.file %}{% $node.file %}{% /if %}{% if $node.name %}{% $node.name %} [{% $node.kind %}] {% range($node.selection) %}{% if $node.extent %} · range {% range($node.extent) %}{% /if %} · calls {% list($node.sites) %}{% /if %}`,
      },
    }).text,
  ).toMatchInlineSnapshot(`
    "src/navigation.tools.ts
    └  renderDocument [function] 57:14-57:28 · range 57:31-71:2 · calls 642:30-642:44, 676:30-676:44"
  `);
});

test("nests an outline the shape a language server reports it", () => {
  // An outline arrives as a tree, so it is passed as one. Rebuilding nesting
  // from a depth counted onto every entry was a step in between that only
  // existed because the tag took a flat list.
  expect(
    renderDocument({
      source: `{% tree entries=$outline partial="node.mdoc" /%}`,
      file: "outline.test.mdoc",
      variables: {
        outline: [
          {
            name: "createTypeAtlas",
            kind: "function",
            selection: span(117, 13, 117, 28),
            children: [{ name: "ask", kind: "variable", selection: span(125, 8, 125, 11) }],
          },
        ],
      },
      partials: {
        "node.mdoc": `{% $node.name %} [{% $node.kind %}] {% range($node.selection) %}`,
      },
    }).text,
  ).toMatchInlineSnapshot(`
    "createTypeAtlas [function] 118:14-118:29
    └  ask [variable] 126:9-126:12"
  `);
});

test("renders nothing for an empty result, leaving the document to say so", () => {
  expect(compose(`{% tree entries=$entries /%}`, { entries: [] })).toBe("");
  expect(compose(`{% rows entries=$entries /%}`, { entries: [] })).toBe("");
});
