import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vite-plus/test";
import { functions, render, renderDocument, tags } from "../src/document/index.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

const span = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

test("renders plain Markdown, with no component involved", () => {
  // The renderer implements Markdoc's own vocabulary, so a document that uses
  // none of these components still renders.
  expect(compose(`# Title\n\nA paragraph.\n\n- one\n- two\n`)).toMatchInlineSnapshot(`
    "# Title

    A paragraph.

    - one
    - two"
  `);
});

test("nests components without any of them deciding spacing", () => {
  const document = `
{% section title="Problems" %}
{% severity value=$problem.severity /%} {% range($problem.range) %}
{% /section %}

{% section title="References" level=3 %}
{% tree entries=$references /%}
{% /section %}
`;
  expect(
    compose(document, {
      problem: { severity: 2, range: span(11, 6, 11, 17) },
      references: [{ name: "src/app.tsx", children: [{ name: "10:3-10:7:  openMotionRuntime," }] }],
    }),
  ).toMatchInlineSnapshot(`
    "## Problems

    warning 12:7-12:18

    ### References

    src/app.tsx
    └  10:3-10:7:  openMotionRuntime,"
  `);
});

test("carries verbatim source through untouched", () => {
  // Whether a document can hold source decides whether a tool that returns
  // source has to render itself. The hazards are all here: markup characters,
  // a tag delimiter, leading indentation, a blank line, and a trailing space.
  const source = [
    "export const x = {",
    "  // a *bold* claim and _underscores_",
    "  tag: `{% frame /%}`,",
    "",
    "  trailing: 1   ",
    "};",
  ].join("\n");
  expect(compose(`{% $source %}`, { source })).toBe(source);
});

test("lets a document read how many of something it was given", () => {
  // Whether a section can title itself `Implementations (3)` from the data it
  // renders decides where counted headings live: in the document, or in a
  // component the document can only call.
  expect(
    compose(`{% $items.length %} of {% $all.length %}`, { items: [1, 2, 3], all: [1, 2] }),
  ).toBe("3 of 2");
});

test("repeats a partial once per item, binding each to a name", () => {
  // The engine resolves the whole tree before any tag transforms, so a loop
  // cannot hold its body as children. A partial is kept as raw source, which
  // can be transformed again per item — which is what makes a repeated block a
  // document's decision rather than a component's.
  expect(
    renderDocument({
      source: `{% each items=$packages as="package" partial="package.mdoc" /%}`,
      file: "loop.test.mdoc",
      variables: {
        packages: [
          { name: "chokidar", version: "3.6.0" },
          { name: "pathe", version: "2.0.3" },
        ],
      },
      partials: { "package.mdoc": `=== {% $package.name %}@{% $package.version %} ===` },
    }).text,
  ).toMatchInlineSnapshot(`
    "=== chokidar@3.6.0 ===

    === pathe@2.0.3 ==="
  `);
});

test("expresses nesting as a tag, since markup cannot carry the spaces itself", () => {
  expect(
    compose(
      `{% tight %}
{% $file %}
{% indent %}
{% $first %}\\
{% $second %}
{% /indent %}
{% /tight %}`,
      { file: "src/app.ts", first: "10:3 — inside open", second: "14:7 — inside close" },
    ),
  ).toMatchInlineSnapshot(`
    "src/app.ts
      10:3 — inside open
      14:7 — inside close"
  `);
});

test("cannot carry leading indentation through markup", () => {
  // Whether a document can indent a row under a heading decides whether nesting
  // can be markup or has to stay with the layout that draws it. Markdown owns
  // leading whitespace — it means code block, or it means nothing — so a
  // document cannot say "two spaces here" and be obeyed.
  expect(compose("parent\n\n  child")).toBe("parent\n\nchild");
  expect(compose("parent\n\n    child")).not.toBe("parent\n\n    child");
});

test("carries a newline through a tag attribute, which MF2 selection needs", () => {
  // An MF2 message that selects on a plural category is multi-line by syntax:
  // `.match` and each variant sit on their own line. Whether a document can
  // hold one inline decides where messages live — in the document beside the
  // prose they belong to, or in a keyed catalog away from it.
  expect(compose(`{% $value %}`, { value: "a\nb" })).toBe("a\nb");
  expect(compose(`{% truncate value="a\\nb" columns=99 /%}`)).toBe("a\nb");
});

test("cannot bind a per-item variable to inline children, only to a partial", () => {
  // `Markdoc.transform` deep-resolves the whole tree against one set of
  // variables before any tag's transform runs, so a tag cannot scope a name to
  // its children — the Variable nodes are already gone. Iteration therefore
  // belongs to a component, not to a document, and this pins the constraint
  // that decides it.
  expect(compose(`{% $item.name %}`, { item: { name: "bound" } })).toBe("bound");
  expect(compose(`{% $item.name %}`)).toBe("");
});

test("composes rows as children, named where they are written", () => {
  expect(
    compose(`
{% summary %}
{% row label="Test Files" value="2 failed | 2 passed (4)" /%}
{% row label="Duration" value="1.23s" /%}
{% /summary %}
`),
  ).toMatchInlineSnapshot(`
    " Test Files 2 failed | 2 passed (4)
       Duration 1.23s"
  `);
});

test("puts values inside a block with functions, not tags", () => {
  // A function returns something insertable; it has no children and cannot
  // compose, which is right for a value and wrong for structure.
  expect(
    compose(`{% time(4502) %} · {% width("東京") %} · {% plural count=1 forms=$forms /%}`, {
      forms: { one: "ref", other: "refs" },
    }),
  ).toBe("4.50s · 4 · ref");
});

test("puts a computed value into a component's attribute", () => {
  expect(
    compose(`{% summary %}{% row label="Duration" value=$elapsed /%}{% /summary %}`, {
      elapsed: "4.50s",
    }),
  ).toMatchInlineSnapshot(`"   Duration 4.50s"`);
});

test("lets a document name what an unknown severity is called", () => {
  expect(
    compose(`{% severity config=$config /%}`, {
      config: { messages: { "diagnostic.severity.unknown": "unbekannt" } },
    }),
  ).toBe("unbekannt");
});

test("banners a name the document composes, in marks config decides", () => {
  // The name is built the way every other line is — a value, a count, a form
  // chosen by that count — so the banner takes children rather than a string.
  // What encloses it is a mark, so a consumer that cannot render `===` changes
  // one setting instead of every document.
  expect(
    compose(
      `{% banner %}{% $file %} · {% $lines %} {% plural count=$lines forms={"one": "line", "other": "lines"} /%}{% /banner %}`,
      { file: "packages/core/package.json", lines: 75 },
    ),
  ).toBe("=== packages/core/package.json · 75 lines ===");
  expect(
    compose(`{% banner config=$config %}src/app.ts{% /banner %}`, {
      config: { marks: { bannerOpen: "## ", bannerClose: "" } },
    }),
  ).toBe("## src/app.ts");
});
