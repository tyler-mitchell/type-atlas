import type { Currency } from "@ledger/money";

/** How one bank's CSV export deviates from the common shape. */
export interface BankProfile {
  readonly delimiter: string;
  readonly dateFormat: string;
  readonly currency: Currency;
  readonly columns: { readonly date: number; readonly description: number; readonly amount: number };
  readonly quirks: { readonly invertAmounts: boolean; readonly skipRows: number };
}

/**
 * Per-bank export profiles, keyed by the code on the statement footer. The
 * kind of value a config file accumulates: three levels of nested literals
 * that an outline must not mistake for declarations.
 */
export const bankProfiles = {
  "first-national": {
    delimiter: ",",
    dateFormat: "MM/dd/yyyy",
    currency: "USD",
    columns: { date: 0, description: 1, amount: 3 },
    quirks: { invertAmounts: false, skipRows: 1 },
  },
  "credit-mutuel": {
    delimiter: ";",
    dateFormat: "dd/MM/yyyy",
    currency: "EUR",
    columns: { date: 0, description: 2, amount: 4 },
    quirks: { invertAmounts: true, skipRows: 0 },
  },
  "pacific-savings": {
    delimiter: ",",
    dateFormat: "yyyy-MM-dd",
    currency: "USD",
    columns: { date: 1, description: 2, amount: 3 },
    quirks: { invertAmounts: false, skipRows: 2 },
  },
} satisfies Record<string, BankProfile>;

export const profileFor = (statementFooter: string): BankProfile | undefined =>
  bankProfiles[statementFooter.trim().toLowerCase() as keyof typeof bankProfiles];
