import { expect, test } from "vite-plus/test";
import {
  codeFrame,
  connectorGuide,
  connectorParts,
  diagnosticSeverity,
  hierarchy,
  rowBranches,
  rows,
} from "../src/index.ts";

/**
 * The components, used the way a consumer without a document layer would.
 *
 * No Markdoc anywhere in this file. If any of these ever needs it, the claim
 * that the domain layer is independent of the document layer has stopped being
 * true, and this test is where that shows up.
 */

test("renders located rows under their file without a document layer", () => {
  // What `locations` used to compose. The grouping and the fields are the
  // caller's now — a document decides them for this repository's tools — and
  // what the library still owns is the nesting underneath.
  expect(
    rows([
      {
        name: "src/app.tsx",
        children: [{ name: "10:3-10:7", fields: ["openMotionRuntime,"] }, { name: "12:7-12:11" }],
      },
    ]).join("\n"),
  ).toMatchInlineSnapshot(`
    "src/app.tsx
    ├  10:3-10:7 · openMotionRuntime,
    └  12:7-12:11"
  `);
});

test("names a severity and frames its source without a document layer", () => {
  // What composing a problem needs, minus the composing: the word for a
  // severity, and the excerpt under it. A consumer arranging these itself is
  // the case this file exists to keep working.
  expect(diagnosticSeverity(1)).toBe("error");
  expect(diagnosticSeverity(undefined)).toBe("problem");
  expect(
    codeFrame({
      source: `const x: string = 1;\n`,
      line: 1,
      character: 19,
      end: { line: 1, character: 20 },
      range: 0,
    }),
  ).toMatchInlineSnapshot(`
    "  1 | const x: string = 1;
        |                   ^"
  `);
});

test("renders an outline without a document layer", () => {
  expect(
    hierarchy({
      branches: rowBranches([
        {
          name: "createTypeAtlas",
          kind: "function",
          fields: ["118:14-118:18"],
          children: [{ name: "ask", kind: "function", fields: ["121:9-121:13"] }],
        },
      ]),
      guide: connectorGuide(connectorParts()),
    }).join("\n"),
  ).toMatchInlineSnapshot(`
    "createTypeAtlas [function] · 118:14-118:18
    └  ask [function] · 121:9-121:13"
  `);
});

test("draws a call hierarchy's connectors without a document layer", () => {
  expect(
    hierarchy({
      branches: rowBranches([
        {
          name: "src/operations.ts",
          children: [
            { name: "sendRequest", kind: "method", fields: ["127:7-127:11", "calls 131:3-131:7"] },
          ],
        },
      ]),
      guide: connectorGuide(connectorParts()),
    }).join("\n"),
  ).toMatchInlineSnapshot(`
    "src/operations.ts
    └  sendRequest [method] · 127:7-127:11 · calls 131:3-131:7"
  `);
});

test("draws depth for a caller that passes no guide of its own", () => {
  // The guide comes from config, so a consumer with no opinion still gets the
  // one every tool uses, and one setting changes all of them together.
  expect(rows([{ name: "outer", children: [{ name: "inner" }] }]).join("\n"))
    .toMatchInlineSnapshot(`
    "outer
    └  inner"
  `);
  expect(rows([{ name: "outer", children: [{ name: "inner" }] }], { guide: "indent" }).join("\n"))
    .toMatchInlineSnapshot(`
    "outer
      inner"
  `);
});
