// DELIBERATELY BROKEN — the imports for `money` and `signedAmount` are
// missing, so `add_missing_imports` scenarios have real work to do. Do not
// fix; see the fixture README.
import type { Posting } from "@ledger/accounts";
import type { StatementLine } from "./drift.ts";

/** Pair journal postings with the statement lines they explain. */
export const matchPostings = (
  postings: readonly Posting[],
  lines: readonly StatementLine[],
): ReadonlyMap<Posting, StatementLine> => {
  const matched = new Map<Posting, StatementLine>();
  for (const posting of postings) {
    const amount = signedAmount(posting);
    const line = lines.find(
      (candidate) => candidate.amount.minorUnits === amount.minorUnits,
    );
    if (line) matched.set(posting, line);
  }
  return matched;
};

/** The zero of a matching pass, for currencies the statement never names. */
export const emptyRemainder = () => money(0, "USD");
