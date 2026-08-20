import { expect, test } from "vite-plus/test";
import { defaultMessages, translate } from "../src/config/messages.ts";
import { message } from "../src/text/message.ts";

test("fills a placeholder by name", () => {
  expect(message({ source: "Search: {$query}", values: { query: "indentGuide" } })).toBe(
    "Search: indentGuide",
  );
});

test("selects on plural category, which is the whole reason for the spec", () => {
  const source =
    ".input {$count :integer}\n.match $count\none {{{$count} unchanged line}}\n* {{{$count} unchanged lines}}";
  expect(message({ source, values: { count: 1 } })).toBe("1 unchanged line");
  expect(message({ source, values: { count: 4 } })).toBe("4 unchanged lines");
});

test("selects by the locale's own rules, not by English's two forms", () => {
  // Polish has four categories where English has two. The same message answers
  // both, which a `singular`/`plural` pair cannot.
  const source =
    ".input {$count :integer}\n.match $count\none {{plik}}\nfew {{pliki}}\nmany {{plików}}\n* {{pliku}}";
  const forms = [1, 2, 5].map((count) => message({ source, values: { count }, locale: "pl" }));
  expect(forms).toEqual(["plik", "pliki", "plików"]);
});

test("formats every message the catalog ships", () => {
  // A catalog entry that does not parse throws when it is first reached, which
  // in a tool is the moment a reader asked a question. Parsing them all here
  // means a broken message fails in the suite instead.
  const values = {
    count: 2,
    from: 1,
    to: 9,
    alternatives: "definitions",
    root: "/repo",
    query: "x",
  };
  for (const key of Object.keys(defaultMessages)) {
    expect(() => translate({ key, values }), key).not.toThrow();
  }
});
