/** ISO 4217 currencies the ledger accepts. */
export type Currency = "USD" | "EUR" | "GBP" | "JPY";

/** How a currency subdivides and renders — the facts amount math depends on. */
export interface CurrencyProfile {
  readonly currency: Currency;
  /** Minor units per major unit: 100 for cent currencies, 1 for JPY. */
  readonly minorUnitsPerMajor: 100 | 1;
  readonly symbol: string;
}

export const currencyProfiles: Record<Currency, CurrencyProfile> = {
  USD: { currency: "USD", minorUnitsPerMajor: 100, symbol: "$" },
  EUR: { currency: "EUR", minorUnitsPerMajor: 100, symbol: "€" },
  GBP: { currency: "GBP", minorUnitsPerMajor: 100, symbol: "£" },
  JPY: { currency: "JPY", minorUnitsPerMajor: 1, symbol: "¥" },
};

export const isCurrency = (value: string): value is Currency => value in currencyProfiles;
