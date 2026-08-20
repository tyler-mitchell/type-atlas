import { asciiFigures, configurePresentation, displayPath, resolve } from "atlascii";
import { afterEach, expect, test } from "vite-plus/test";
import { presentationFromEnvironment } from "../src/presentation.ts";

const environment = { ...process.env };

afterEach(() => {
  process.env = { ...environment };
  configurePresentation({});
});

test("reads nothing from an environment that names nothing", () => {
  // A client that sets no preference gets the library's defaults, and every
  // namespace stays independently absent rather than being filled in with a
  // theme nobody chose.
  process.env = { ...environment };
  delete process.env.TYPE_ATLAS_GLYPHS;
  delete process.env.TYPE_ATLAS_GUIDE;
  delete process.env.TYPE_ATLAS_PATHS;
  const chosen = presentationFromEnvironment();
  expect(chosen.figures).toBeUndefined();
  expect(chosen.guide).toBeUndefined();
  expect(chosen.paths).toBeUndefined();
});

test("ignores a value it does not recognise rather than refusing to start", () => {
  // A server that dies over a typo in a display preference has turned a
  // cosmetic setting into an outage.
  process.env.TYPE_ATLAS_GUIDE = "connector";
  process.env.TYPE_ATLAS_PATHS = "relative";
  const chosen = presentationFromEnvironment();
  expect(chosen.guide).toBeUndefined();
  expect(chosen.paths).toBeUndefined();
});

test("carries each choice from the environment to what renders", () => {
  // The whole path the goal asked for: a client names a preference where MCP
  // clients name things, and it reaches the thing that draws.
  process.env.TYPE_ATLAS_PATHS = "absolute";
  process.env.TYPE_ATLAS_GUIDE = "indent";
  process.env.TYPE_ATLAS_GLYPHS = "ascii";
  configurePresentation(presentationFromEnvironment());

  expect(displayPath("file:///repo/src/app.ts", "/repo")).toBe("/repo/src/app.ts");
  expect(resolve().figures).toBe(asciiFigures);
  // The indent guide draws depth as spaces; the connector guide would put a
  // box-drawing glyph here.
  expect(resolve().guide({ depth: 1, last: true, trail: [false, true] }).first).toBe("  ");
});

test("names a file against the package that holds it, found on disk", () => {
  // The `project` style end to end, against this repository rather than a stub:
  // the resolver walks up from the file to the nearest manifest, so a path in
  // one package of a monorepo is named without the repository root on every
  // line. Nothing at the call site changed — a path is still rendered from a
  // URI and a workspace root.
  process.env.TYPE_ATLAS_PATHS = "project";
  configurePresentation(presentationFromEnvironment());
  const repository = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");

  expect(displayPath(`file://${repository}/packages/mcp/src/server.ts`, repository)).toBe(
    "src/server.ts",
  );
  expect(displayPath(`file://${repository}/atlascii/src/index.ts`, repository)).toBe(
    "src/index.ts",
  );
});

test("lets a caller that states a style outrank what the host chose", () => {
  // Session-wide is a default, not an override: a tool with a reason — a path
  // being handed to something outside the answer — still gets to say so.
  process.env.TYPE_ATLAS_PATHS = "absolute";
  configurePresentation(presentationFromEnvironment());
  expect(displayPath("file:///repo/src/app.ts", "/repo", { style: "workspace" })).toBe(
    "src/app.ts",
  );
});
