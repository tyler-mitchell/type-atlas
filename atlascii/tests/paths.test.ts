import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { configurePresentation } from "../src/config/index.ts";
import { displayPath, slash } from "../src/protocol/uri.ts";

const root = join(import.meta.dirname, "repo");
const uri = (...path: string[]) => pathToFileURL(join(root, ...path)).href;
const absolute = (...path: string[]) => slash(join(root, ...path));

afterEach(() => configurePresentation({}));

test("names a file against the root it was measured from", () => {
  // The default, and the reason it is the default: the root is stated once in
  // the preamble, and repeating it on every row costs a reader more than it
  // tells them.
  expect(displayPath(uri("src", "app.ts"), root)).toBe("src/app.ts");
});

test("hands back an absolute path when asked for one", () => {
  // For giving to something outside this answer — a shell, an editor, another
  // tool — where a path relative to a root it never saw means nothing.
  expect(displayPath(uri("src", "app.ts"), root, { style: "absolute" })).toBe(
    absolute("src", "app.ts"),
  );
});

test("measures from the project when the project is the frame of reference", () => {
  // Working inside one package of a monorepo, the package is what a reader
  // holds in mind and the repository root is noise on every line.
  //
  // The host answers which project a file belongs to, because that is found on
  // disk and this library does not read one. Supplied once rather than at each
  // of the ninety places a path is rendered.
  configurePresentation({
    paths: "project",
    projectRootFor: (file) => {
      const project = absolute("packages", "mcp");
      return file.startsWith(`${project}/`) ? project : undefined;
    },
  });
  expect(displayPath(uri("packages", "mcp", "src", "tool.ts"), root)).toBe("src/tool.ts");
  // A file belonging to no project the host knows falls to the workspace, which
  // is the right answer for a file with no nearer frame of reference.
  expect(displayPath(uri("atlascii", "src", "index.ts"), root)).toBe("atlascii/src/index.ts");
});

test("falls to the workspace when the host answers no project at all", () => {
  // A host that supplies no resolver has not opted out of the style; it has
  // said it cannot answer. Rendering absolutely instead would be a different
  // style than the one asked for.
  configurePresentation({ paths: "project" });
  expect(displayPath(uri("packages", "mcp", "src", "tool.ts"), root)).toBe(
    "packages/mcp/src/tool.ts",
  );
});

test("names a dependency by its package-relative path, not where the manager put it", () => {
  // pnpm's store spends ninety characters on a content address. What identifies
  // this file is the package and the path inside it.
  const stored = uri(
    "node_modules",
    ".pnpm",
    "chokidar@3.6.0",
    "node_modules",
    "chokidar",
    "types",
    "index.d.ts",
  );
  expect(displayPath(stored, root)).toBe("chokidar/types/index.d.ts");
});

test("gives a dependency its real path under the absolute style", () => {
  // An absolute path is for opening. Shortening it to a package-relative name
  // would hand back something no tool can resolve.
  const stored = uri("node_modules", "chokidar", "index.js");
  expect(displayPath(stored, root, { style: "absolute" })).toBe(
    absolute("node_modules", "chokidar", "index.js"),
  );
});

test("states a file outside the root absolutely rather than climbing out of it", () => {
  // `../../../other/repo/src/app.ts` describes a relationship the reader did
  // not ask about and cannot act on.
  const outside = join(import.meta.dirname, "elsewhere", "src", "app.ts");
  expect(displayPath(pathToFileURL(outside).href, root)).toBe(slash(outside));
});

test("normalises a path the sender wrote awkwardly", () => {
  // `pathe` resolves the segments. Stripping a root prefix by string comparison
  // kept whatever the sender wrote — `./src/app.ts` arrived with its `./` still
  // attached, and a root with a trailing slash produced a different answer from
  // one without.
  expect(displayPath(uri(".", "src", "app.ts"), root)).toBe("src/app.ts");
  expect(displayPath(uri("src", "..", "src", "app.ts"), root)).toBe("src/app.ts");
  expect(displayPath(uri("src", "app.ts"), `${root}/`)).toBe("src/app.ts");
});

test("decodes what the URI encoded", () => {
  expect(displayPath(uri("src", "my file.ts"), root)).toBe("src/my file.ts");
});

test("passes through a document that has no file behind it", () => {
  // An `untitled:` buffer is named by its URI and has no path to render.
  expect(displayPath("untitled:Untitled-1", root)).toBe("untitled:Untitled-1");
});

test("names a vendored file by its package whatever language installed it", () => {
  // The rule is language-specific and this library is not, so the directories
  // that mean "installed here" are a list. Adding a language adds a name;
  // nothing about rendering a path changes.
  expect(displayPath(uri("node_modules", "chokidar", "index.js"), root)).toBe("chokidar/index.js");
  expect(
    displayPath(uri("venv", "lib", "python3.12", "site-packages", "rich", "table.py"), root),
  ).toBe("rich/table.py");
  expect(
    displayPath(uri("home", "go", "pkg", "mod", "rsc.io", "quote@v1.5.2", "quote.go"), root),
  ).toBe("rsc.io/quote@v1.5.2/quote.go");
});

test("takes an unlisted vendor directory from configuration, not from an edit here", () => {
  configurePresentation({ vendored: ["vendor/bundle"] });
  expect(
    displayPath(uri("vendor", "bundle", "ruby", "3.3.0", "gems", "rack", "lib", "rack.rb"), root),
  ).toBe("ruby/3.3.0/gems/rack/lib/rack.rb");
});

test("takes the style the host chose when a call names none", () => {
  // The style is a property of the session, not of a call site, so a caller
  // that states nothing follows the host. An explicit argument still wins.
  configurePresentation({ paths: "absolute" });
  expect(displayPath(uri("src", "app.ts"), root)).toBe(absolute("src", "app.ts"));
  expect(displayPath(uri("src", "app.ts"), root, { style: "workspace" })).toBe("src/app.ts");
});

test("writes separators the way a terminal answer should read them", () => {
  // `pathe` returns POSIX separators on every platform, so an answer produced on
  // Windows reads the same as one produced anywhere else. Drive-letter handling
  // is `fileURLToPath`'s and is only observable on Windows: the arithmetic this
  // replaced sliced `file://` off the front, which leaves `/c:/src/app.ts` —
  // absolute, wrong, and silently unmatched against any root.
  expect(slash("src\\layout\\rows.ts")).toBe("src/layout/rows.ts");
  expect(slash("src/layout/rows.ts")).toBe("src/layout/rows.ts");
});
