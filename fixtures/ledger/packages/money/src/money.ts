import { type Currency, currencyProfiles } from "./currency.ts";

declare const brand: unique symbol;

/**
 * An exact amount of one currency, held in minor units (cents, pence, yen).
 *
 * The brand keeps a raw `{ amount, currency }` literal out of ledger math:
 * every `Money` passed through the system was constructed by `money()` and is
 * therefore integral and currency-tagged.
 */
export type Money = {
  readonly minorUnits: bigint;
  readonly currency: Currency;
  readonly [brand]: "Money";
};

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: Currency,
    readonly right: Currency,
  ) {
    super(`Cannot combine ${left} with ${right}`);
  }
}

export const money = (minorUnits: bigint | number, currency: Currency): Money =>
  ({ minorUnits: BigInt(minorUnits), currency }) as Money;

export const zero = (currency: Currency): Money => money(0n, currency);

/**
 * Exact addition in minor units.
 *
 * @throws {@link CurrencyMismatchError} when the currencies differ — ledger
 * math never converts silently.
 */
export const add = (left: Money, right: Money): Money => {
  if (left.currency !== right.currency) {
    throw new CurrencyMismatchError(left.currency, right.currency);
  }
  return money(left.minorUnits + right.minorUnits, left.currency);
};

export const negate = (value: Money): Money => money(-value.minorUnits, value.currency);

export const isZero = (value: Money): boolean => value.minorUnits === 0n;

/** Render for statements: `$12.34`, `-¥5000`. */
export const format = (value: Money): string => {
  const { minorUnitsPerMajor, symbol } = currencyProfiles[value.currency];
  const sign = value.minorUnits < 0n ? "-" : "";
  const magnitude = value.minorUnits < 0n ? -value.minorUnits : value.minorUnits;
  if (minorUnitsPerMajor === 1) return `${sign}${symbol}${magnitude}`;
  const major = magnitude / 100n;
  const minor = magnitude % 100n;
  return `${sign}${symbol}${major}.${minor.toString().padStart(2, "0")}`;
};
