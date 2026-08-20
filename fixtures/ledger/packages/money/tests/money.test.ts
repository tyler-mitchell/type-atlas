import { expect, test } from "vite-plus/test";
import { add, CurrencyMismatchError, format, money, negate } from "../src/index.ts";

test("adds amounts of one currency exactly", () => {
  expect(add(money(1050, "USD"), money(25, "USD")).minorUnits).toBe(1075n);
});

test("refuses to combine currencies", () => {
  expect(() => add(money(100, "USD"), money(100, "EUR"))).toThrow(CurrencyMismatchError);
});

test("formats major and minor units per currency", () => {
  expect(format(money(123456, "GBP"))).toBe("£1234.56");
  expect(format(negate(money(5000, "JPY")))).toBe("-¥5000");
});
