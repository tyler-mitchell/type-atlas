import { add, isZero, type Money, zero } from "@ledger/money";
import type { AccountPath } from "./account.ts";
import { credit, debit, type Posting, signedAmount } from "./posting.ts";

/** A balanced set of postings, recorded together or not at all. */
export interface Entry<TMeta = undefined> {
  readonly recordedAt: Date;
  readonly description: string;
  readonly postings: readonly Posting[];
  readonly meta: TMeta;
}

export class UnbalancedEntryError extends Error {
  constructor(readonly imbalance: Money) {
    super(`Entry does not balance: off by ${imbalance.minorUnits} minor units`);
  }
}

/**
 * An append-only journal of balanced entries. `TMeta` carries whatever a
 * consumer attaches to each entry — an import batch id, an approval trail —
 * without the journal knowing its shape.
 */
export class Journal<TMeta = undefined> {
  private readonly entries: Entry<TMeta>[] = [];

  /** Record a prepared entry, or build the common two-posting transfer. */
  post(entry: Entry<TMeta>): Entry<TMeta>;
  post(
    description: string,
    transfer: { from: AccountPath; to: AccountPath; amount: Money },
    meta: TMeta,
  ): Entry<TMeta>;
  post(
    first: Entry<TMeta> | string,
    transfer?: { from: AccountPath; to: AccountPath; amount: Money },
    meta?: TMeta,
  ): Entry<TMeta> {
    const entry: Entry<TMeta> =
      typeof first === "string"
        ? {
            recordedAt: new Date(),
            description: first,
            postings: [
              debit(transfer!.to, transfer!.amount),
              credit(transfer!.from, transfer!.amount),
            ],
            meta: meta as TMeta,
          }
        : first;
    const imbalance = entry.postings
      .map(signedAmount)
      .reduce(add, zero(entry.postings[0]?.amount.currency ?? "USD"));
    if (!isZero(imbalance)) throw new UnbalancedEntryError(imbalance);
    this.entries.push(entry);
    return entry;
  }

  /** Entries touching an account, oldest first. */
  history(account: AccountPath): readonly Entry<TMeta>[] {
    return this.entries.filter((entry) =>
      entry.postings.some((posting) => posting.account === account),
    );
  }

  get length(): number {
    return this.entries.length;
  }

  [Symbol.iterator](): Iterator<Entry<TMeta>> {
    return this.entries[Symbol.iterator]();
  }
}
