import { expect, test } from "vite-plus/test";
import { renderDocument } from "../src/document/index.ts";

// The whole pipeline, not just the transform: validation calls into the same
// functions a render does, and a test that skips it passes on documents that
// throw the moment a real caller renders them.
const compose = (source: string, variables: Record<string, unknown> = {}) =>
  renderDocument({ source, file: "inspection.test.mdoc", variables }).text;

const span = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

const document = `
{% if $choice %}
Symbol "{% $choice.name %}" is {% $choice.reason %} · {% $choice.file %}
{% if any($choice.candidates) %}

## Candidates ({% fraction($choice) %})

{% tree entries=$choice.candidates /%}
{% /if %}
{% /if %}

{% if $symbol %}
{% $symbol.name %}{% if any($symbol.kind) %} [{% symbolKind($symbol.kind) %}]{% /if %} · {% $symbol.file %}:{% range($symbol.selection) %}{% if $symbol.extent %} · range {% range($symbol.extent) %}{% /if %} · {% if $symbol.project %}{% $symbol.project %}{% /if %}{% if not($symbol.project) %}an inferred project{% /if %}

{% if $documentation %}
{% $documentation %}
{% /if %}

{% if any($additionalDefinitions.groups) %}
## Additional definitions ({% $additionalDefinitions.total %})

{% tree entries=$additionalDefinitions.groups /%}
{% /if %}

{% if $callers %}
## Callers ({% fraction($callers) %})

{% tree entries=$callers.groups /%}
{% /if %}

{% if $callees %}
## Calls ({% fraction($callees) %} workspace · {% $callees.dependencyTotal %} dependency/runtime)

{% if $callees.sharedSite %}
Every call happens in {% $callees.sharedSite %}.
{% /if %}
{% tree entries=$callees.groups /%}
{% if any($callees.dependencies) %}
Dependency/runtime: {% list($callees.dependencies) %}
{% /if %}
{% /if %}

{% if any($mentions.groups) %}
## Mentions that are not calls ({% $mentions.shown %} of {% $mentions.other %} · {% $mentions.total %} references in all)

{% tree entries=$mentions.groups /%}
{% /if %}

{% if $source %}
## Source · {% $source.file %}:{% range($source.range) %}

{% source lines=$source.lines startLine=$source.startLine /%}
{% /if %}
{% /if %}
`;

const variables = {
  symbol: {
    name: "fileViews",
    kind: 12,
    file: "src/components/file-views.ts",
    selection: span(32, 13, 32, 22),
    extent: span(32, 0, 95, 2),
    project: "/repo/tsconfig.json",
  },
  documentation: "Files with their contents.",
  additionalDefinitions: { groups: [], shown: 0, total: 0 },
  callers: undefined,
  mentions: { groups: [], shown: 0, other: 0, total: 0 },
  callees: {
    groups: [
      {
        name: "src/source/folded.ts",
        children: [
          {
            name: "foldedSource",
            kind: "function",
            fields: ["30:14-30:26", "range 30:29-119:2", "calls 48:22-48:34"],
          },
        ],
      },
    ],
    shown: 1,
    total: 1,
    dependencies: ["map", "reduce", "split"],
    dependencyTotal: 3,
    sharedSite: undefined,
  },
  source: {
    file: "src/components/file-views.ts",
    range: span(32, 0, 33, 2),
    lines: ["export const fileViews = (", "});"],
    startLine: 33,
  },
};

test("composes an inspection from its parts, deciding nothing in TypeScript", () => {
  expect(compose(document, variables)).toMatchInlineSnapshot(`
    "fileViews [function] · src/components/file-views.ts:33:14-33:23 · range 33:1-96:3 · /repo/tsconfig.json

    Files with their contents.

    ## Calls (1 workspace · 3 dependency/runtime)

    src/source/folded.ts
    └  foldedSource [function] · 30:14-30:26 · range 30:29-119:2 · calls 48:22-48:34

    Dependency/runtime: map, reduce, split

    ## Source · src/components/file-views.ts:33:1-34:3

    33 | export const fileViews = (
    34 | });"
  `);
});
