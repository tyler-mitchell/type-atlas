import {
  type AccountPath,
  type Entry,
  type Journal,
  lineage,
  signedAmount,
} from "@ledger/accounts";
import { add, type Currency, type Money, zero } from "@ledger/money";

/** A point-in-time balance, rolled up through the account hierarchy. */
export interface BalanceLine {
  readonly account: AccountPath;
  readonly balance: Money;
  /** Direct postings only, before descendants roll up into this line. */
  readonly own: Money;
}

/**
 * Every account's balance as of a cutoff, including ancestor accounts that
 * were never posted to directly — `assets` earns a line because
 * `assets:bank:checking` did.
 */
export const balancesAsOf = <TMeta>(
  journal: Journal<TMeta>,
  cutoff: Date,
  currency: Currency,
): readonly BalanceLine[] => {
  const own = new Map<AccountPath, Money>();
  for (const entry of journal) {
    if (entry.recordedAt > cutoff) continue;
    for (const posting of entry.postings) {
      own.set(
        posting.account,
        add(own.get(posting.account) ?? zero(currency), signedAmount(posting)),
      );
    }
  }
  const rolled = new Map<AccountPath, Money>();
  for (const [account, amount] of own) {
    for (const ancestor of lineage(account)) {
      rolled.set(ancestor, add(rolled.get(ancestor) ?? zero(currency), amount));
    }
  }
  return [...rolled.entries()]
    .map(([account, balance]) => ({
      account,
      balance,
      own: own.get(account) ?? zero(currency),
    }))
    .sort((left, right) => left.account.localeCompare(right.account));
};

/** The description an entry renders with on a statement line. */
export type StatementDescription<TEntry> = TEntry extends Entry<infer TMeta>
  ? TMeta extends { reference: string }
    ? `${string} (${string})`
    : string
  : never;
