import { expect, test } from "vitest";
import { formatNumber } from "../src/text/number.ts";

test("separates thousands, with precision that follows magnitude", () => {
  // Four decimals below a hundred, two above: small measurements need the
  // precision, large ones would only carry noise.
  expect(formatNumber(1234567.891)).toMatchInlineSnapshot(`"1,234,567.89"`);
  expect(formatNumber(12.3456789)).toMatchInlineSnapshot(`"12.3457"`);
});
