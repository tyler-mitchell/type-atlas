import { expect, test } from "vite-plus/test";
import { plural } from "../src/text/plural.ts";

const english = { one: "{count} reference", other: "{count} references" };

test("selects the form a count takes, filling the count in", () => {
  expect(plural({ count: 1, forms: english })).toBe("1 reference");
  expect(plural({ count: 3, forms: english })).toBe("3 references");
  expect(plural({ count: 0, forms: english })).toBe("0 references");
});

test("uses the categories a language actually has, not English's two", () => {
  // Polish has four: one / few / many / other. A two-form API cannot express
  // this, which is the reason for selecting on CLDR categories at all.
  const polish = {
    one: "{count} odwołanie",
    few: "{count} odwołania",
    many: "{count} odwołań",
    other: "{count} odwołania",
  };
  expect([1, 2, 5, 22].map((count) => plural({ count, forms: polish, locale: "pl" }))).toEqual([
    "1 odwołanie",
    "2 odwołania",
    "5 odwołań",
    "22 odwołania",
  ]);
});

test("needs only one form for a language that has one", () => {
  // Japanese does not inflect for number. A catalog for it is one entry, not
  // two with the same text.
  expect(
    [1, 5].map((count) => plural({ count, forms: { other: "{count} 件の参照" }, locale: "ja" })),
  ).toEqual(["1 件の参照", "5 件の参照"]);
});

test("falls back to the required form when a category is not supplied", () => {
  // `other` is the one CLDR guarantees, so a partial set still renders.
  expect(plural({ count: 5, forms: { one: "one", other: "many" }, locale: "pl" })).toBe("many");
});

test("selects ordinals by the same rules with a different type", () => {
  const forms = { one: "{count}st", two: "{count}nd", few: "{count}rd", other: "{count}th" };
  expect([1, 2, 3, 4, 11, 21].map((count) => plural({ count, forms, type: "ordinal" })))
    .toMatchInlineSnapshot(`
    [
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "21st",
    ]
  `);
});
