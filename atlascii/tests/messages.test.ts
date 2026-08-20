import Markdoc from "@markdoc/markdoc";
import { expect, test } from "vite-plus/test";
import { counts } from "../src/components/counts.ts";
import { defaultMessages, translate } from "../src/config/messages.ts";
import { functions, render, tags } from "../src/document/index.ts";

const compose = (source: string, variables: Record<string, unknown> = {}) =>
  render(Markdoc.transform(Markdoc.parse(source), { tags, functions, variables }));

const german: Record<string, string> = {
  "diagnostic.severity.1": "Fehler",
  "diagnostic.severity.2": "Warnung",
  "diagnostic.severity.unknown": "Problem",
  "counts.empty": "keine",
  "range.extent": "Bereich",
  "diff.omitted":
    ".input {$count :integer}\n.match $count\none {{{$count} unveränderte Zeile}}\n* {{{$count} unveränderte Zeilen}}",
};

test("falls back to the default catalog for keys a translation omits", () => {
  // A partial translation is the normal case, not an error — an untranslated
  // key should still say something true.
  expect(translate({ key: "diagnostic.severity.3", messages: german })).toBe("info");
  expect(translate({ key: "diagnostic.severity.1", messages: german })).toBe("Fehler");
});

test("shows a missing key rather than rendering nothing", () => {
  // A hole in a catalog that renders blank is invisible; one that renders its
  // key is a bug report.
  expect(translate({ key: "nothing.defined.here" })).toBe("nothing.defined.here");
});

test("lets the message decide its own plural, in its own language", () => {
  // Which forms a language has is the language's business, not a caller's. The
  // catalog holds the selection, so a translator adding a form adds it here and
  // nothing upstream learns about it.
  expect(translate({ key: "diff.omitted", messages: german, values: { count: 1 } })).toBe(
    "1 unveränderte Zeile",
  );
  expect(translate({ key: "diff.omitted", messages: german, values: { count: 4 } })).toBe(
    "4 unveränderte Zeilen",
  );
});

test("names a severity through the catalog, from a document", () => {
  // Which word stands for severity 1 is the catalog's decision and the
  // document only asks for it, so a consumer with its own catalog renames
  // every problem in every tool at once.
  expect(
    compose(`{% severity value=1 config=$config /%} {% severity config=$config /%}`, {
      config: { messages: german },
    }),
  ).toBe("Fehler Problem");
});

test("translates counts from the same catalog", () => {
  expect(
    counts({ states: [{ name: "fehlgeschlagen", count: 0 }], config: { messages: german } }),
  ).toBe("keine");
});

test("keeps a default catalog that covers every key the library asks for", () => {
  // Anything reaching for a key nothing defines renders the key, which this
  // catches before a reader sees it.
  const asked = [
    "diagnostic.severity.1",
    "diagnostic.severity.unknown",
    "diff.expected",
    "diff.received",
    "diff.omitted",
    "fold.placeholder",
    "range.extent",
    "counts.empty",
  ];
  expect(asked.filter((key) => defaultMessages[key] === undefined)).toEqual([]);
});
