import { expect, test } from "vite-plus/test";
import { renderDocument as renderSource } from "atlascii/document";
import { renderDocument } from "./render.ts";

const span = { start: { line: 87, character: 13 }, end: { line: 87, character: 31 } };

test("hover names the file and states the type", async () => {
  const { text, undefinedVariables } = await renderDocument({
    document: "hover.tool.mdoc",
    variables: {
      file: "src/app.ts",
      root: "/repo",
      at: "88:14",
      text: "const openRuntime: () => Runtime",
    },
  });
  expect(undefinedVariables).toEqual([]);
  expect(text).toMatchInlineSnapshot(`
    "src/app.ts:88:14

    const openRuntime: () => Runtime"
  `);
});

test("hover says which nothing when there is no type", async () => {
  const { text } = await renderDocument({
    document: "hover.tool.mdoc",
    variables: { file: "src/app.ts", root: "/repo" },
  });
  expect(text).toContain("Nothing at this position has a type to report");
});

// `page` is left undefined on purpose: an unpaged answer is how these documents
// say there is no next page, so an empty `undefinedVariables` is the wrong bar.
test("completions state the count and the incomplete fact", async () => {
  const { text } = await renderDocument({
    document: "completions.tool.mdoc",
    variables: {
      at: "88:14",
      file: "src/app.ts",
      root: "/repo",
      total: 2,
      totalNoun: "completions",
      incomplete: true,
      items: [
        { name: "openRuntime", notes: ["() => Runtime"] },
        { name: "openWindow", notes: [] },
      ],
    },
  });
  expect(text).toMatchInlineSnapshot(`
    "src/app.ts:88:14 · 2 completions · incomplete — typing more narrows it

    openRuntime () => Runtime
    openWindow"
  `);
});

test("signature help names the active overload", async () => {
  const { text, undefinedVariables } = await renderDocument({
    document: "signature-help.tool.mdoc",
    variables: {
      at: "88:14",
      file: "src/app.ts",
      root: "/repo",
      total: 1,
      overloadNoun: "signature",
      activeIndex: 1,
      signatures: [
        { name: "openRuntime(frames: number): Runtime", children: [{ name: "frames", notes: [] }] },
      ],
    },
  });
  expect(undefinedVariables).toEqual([]);
  expect(text).toMatchInlineSnapshot(`
    "src/app.ts:88:14 · 1 signature · number 1 in use

    openRuntime(frames: number): Runtime
    └  frames"
  `);
});

test("inlay hints group under the file", async () => {
  const { text, undefinedVariables } = await renderDocument({
    document: "inlay-hints.tool.mdoc",
    variables: {
      at: "80:1-90:1",
      file: "src/app.ts",
      root: "/repo",
      total: 1,
      totalNoun: "hint",
      hints: [{ name: "88:14", notes: [": Runtime"] }],
    },
  });
  expect(undefinedVariables).toEqual([]);
  expect(text).toMatchInlineSnapshot(`
    "src/app.ts:80:1-90:1 · 1 hint

    88:14 : Runtime"
  `);
});

test("module exports name the surface asked for", async () => {
  const { text } = await renderDocument({
    document: "module-exports.tool.mdoc",
    variables: {
      module: "react",
      from: "src/app.ts",
      root: "/repo",
      surface: "runtime",
      query: "use",
      broadened: false,
      total: 2,
      totalNoun: "exports",
      items: [
        { name: "useState", kind: "function", signature: "<S>(initial: S) => [S, Setter<S>]" },
        { name: "useEffect", kind: "function" },
      ],
    },
  });
  expect(text).toMatchInlineSnapshot(`
    "Seen from src/app.ts · runtime surface · matching use.

    === react · 2 exports ===

    function useState: <S>(initial: S) => [S, Setter<S>]
    function useEffect"
  `);
});

test("document links tell a file that links nowhere from a provider that never answered", async () => {
  const { text } = await renderDocument({
    document: "document-links.tool.mdoc",
    variables: {
      answered: true,
      file: "src/app.ts",
      root: "/repo",
      total: 0,
      totalNoun: "links",
      groups: [],
    },
  });
  expect(text).toContain("Nothing in src/app.ts links anywhere");
  const unanswered = await renderDocument({
    document: "document-links.tool.mdoc",
    variables: { answered: false, file: "src/app.ts", root: "/repo", total: 0, groups: [] },
  });
  expect(unanswered.text).toContain("No provider answered");
});

test("references reads as prose with owners named", async () => {
  const { text, undefinedVariables } = await renderDocument({
    document: "references.tool.mdoc",
    variables: {
      subject: "down",
      kind: "property",
      found: true,
      container: "Figures",
      declaredAt: { file: "src/config/figures.ts", at: { line: 13, character: 11 } },
      everyProject: false,
      projects: 1,
      anchor: "tsconfig.json",
      root: "/repo",
      total: 3,
      noUses: false,
      groups: [
        {
          file: "src/config/figures.ts",
          children: [
            { at: "30:3", column: 5, within: "figures" },
            { at: "55:3", column: 5, within: "asciiFigures" },
          ],
        },
      ],
    },
  });
  expect(undefinedVariables).toEqual([]);
  expect(text).toMatchInlineSnapshot(`
    "down [property] · inside Figures · src/config/figures.ts:14:12
    3 references · project scope · tsconfig.json

    src/config/figures.ts
    ├  30:3  — inside figures
    └  55:3  — inside asciiFigures"
  `);
});

test("an inspection renders from the variables its handler produces", async () => {
  const { text } = await renderDocument({
    document: "inspect-symbol.tool.mdoc",
    variables: {
      symbol: {
        name: "fileViews",
        kind: 12,
        file: "src/components/file-views.ts",
        selection: span,
        range: span,
        project: "/repo/tsconfig.json",
      },
      documentation: "Files with their contents.",
      additionalDefinitions: { groups: [], shown: 0, total: 0 },
      implementations: { groups: [], shown: 0, total: 0 },
      typeDefinitions: { groups: [], shown: 0, total: 0 },
      callers: undefined,
      callees: undefined,
      mentions: { groups: [], shown: 0, other: 0, total: 0 },
      source: undefined,
    },
  });
  expect(text).toContain("fileViews [function] · src/components/file-views.ts:88:14");
});

test("a document naming a tag the renderer lacks fails loudly", () => {
  expect(() =>
    renderSource({ source: "{% noSuchTag /%}", file: "invented.mdoc", variables: {} }),
  ).toThrow(/does not have: Undefined tag: 'noSuchTag'/);
});

test("every document says which nothing it is when it has nothing to show", async () => {
  const empty = [
    ["definitions.tool.mdoc", { total: 0 }],
    ["type-definitions.tool.mdoc", { total: 0 }],
    ["implementations.tool.mdoc", { total: 0 }],
    ["document-highlights.tool.mdoc", { total: 0, file: "src/app.ts" }],
    ["references.tool.mdoc", { total: 0 }],
    ["selection-ranges.tool.mdoc", { total: 0, file: "src/app.ts" }],
    ["workspace-symbols.tool.mdoc", { total: 0, query: "x", anchor: "t.json", root: "/repo" }],
    ["file-references.tool.mdoc", { total: 0, file: "src/app.ts" }],
    ["hover.tool.mdoc", { file: "src/app.ts" }],
    ["completions.tool.mdoc", { total: 0, at: "88:14", file: "src/app.ts" }],
    ["inlay-hints.tool.mdoc", { total: 0, file: "src/app.ts" }],
    ["document-links.tool.mdoc", { total: 0, file: "src/app.ts" }],
    [
      "module-exports.tool.mdoc",
      {
        total: 0,
        module: "react",
        surface: "runtime",
        query: "",
        from: "src/app.ts",
        root: "/repo",
      },
    ],
  ] as const;
  for (const [document, variables] of empty) {
    // Naming a tag or function that does not exist throws, so reaching the
    // assertion below is itself the proof that every document composes only
    // components this renderer has.
    const { text } = await renderDocument({ document, variables });
    expect(text.length, `${document} says which nothing it is`).toBeGreaterThan(40);
  }
});
