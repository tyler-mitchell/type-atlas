import { signedAmount } from "@ledger/accounts";
import { add, isZero, zero, type Money } from "@ledger/money";
import { matches, type AccountPattern, type RuleHandler } from "./rule.ts";

/** Entries dated in the future are drafts, not records. */
export const noFutureEntries =
  <TMeta>(today: () => Date): RuleHandler<TMeta, "entry:recorded"> =>
  ({ entry }) =>
    entry.recordedAt > today()
      ? { allow: false, reason: `Entry dated ${entry.recordedAt.toISOString()} is in the future` }
      : { allow: true };

/** Postings to a protected branch need to name a whole account, not the branch. */
export const noDirectBranchPostings =
  <TMeta>(branch: AccountPattern): RuleHandler<TMeta, "posting:written"> =>
  ({ posting }) =>
    matches(branch, posting.account) && !posting.account.includes(":")
      ? { allow: false, reason: `Post to a leaf under ${branch}, not the branch itself` }
      : { allow: true };

/** A closed period must balance to zero across every entry it holds. */
export const closedPeriodsBalance = <TMeta>(): RuleHandler<TMeta, "period:closed"> => {
  return ({ entries }) => {
    const total = entries
      .flatMap((entry) => entry.postings)
      .map(signedAmount)
      .reduce<Money | undefined>(
        (held, amount) => (held === undefined ? amount : add(held, amount)),
        undefined,
      );
    return total === undefined || isZero(total)
      ? { allow: true }
      : { allow: false, reason: `Period is off by ${total.minorUnits} minor units` };
  };
};

/** Amounts at or above the threshold need a second signature. */
export const largeAmountsNeedApproval =
  <TMeta extends { readonly approvedBy?: string }>(
    threshold: Money,
  ): RuleHandler<TMeta, "posting:written"> =>
  ({ posting, entry }) => {
    const magnitude =
      posting.amount.minorUnits < 0n ? -posting.amount.minorUnits : posting.amount.minorUnits;
    if (magnitude < threshold.minorUnits) return { allow: true };
    return entry.meta.approvedBy
      ? { allow: true }
      : { allow: false, reason: `Amounts over ${threshold.minorUnits} minor units need approval` };
  };
