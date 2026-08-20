import { type Money, negate } from "@ledger/money";
import type { AccountPath } from "./account.ts";

/**
 * One side of a journal entry. The discriminant is the bookkeeping side, so
 * every consumer's switch is checked for exhaustiveness by the compiler.
 */
export type Posting =
  | { readonly side: "debit"; readonly account: AccountPath; readonly amount: Money }
  | { readonly side: "credit"; readonly account: AccountPath; readonly amount: Money };

export const debit = (account: AccountPath, amount: Money): Posting => ({
  side: "debit",
  account,
  amount,
});

export const credit = (account: AccountPath, amount: Money): Posting => ({
  side: "credit",
  account,
  amount,
});

/** A posting's effect on a debit-normal running balance. */
export const signedAmount = (posting: Posting): Money => {
  switch (posting.side) {
    case "debit":
      return posting.amount;
    case "credit":
      return negate(posting.amount);
  }
};
