// DELIBERATELY BROKEN — this file exists so diagnostics scenarios capture
// real compiler errors from realistic mistakes. Do not fix; see the fixture
// README.
import { type Posting, signedAmount } from "@ledger/accounts";
import { format, money, type Money } from "@ledger/money";

/** A bank statement line to reconcile against the journal. */
export interface StatementLine {
  readonly postedAt: Date;
  readonly amount: Money;
  readonly memo: string;
}

/** Statement total, computed by someone who forgot Money is not a number. */
export const statementTotal = (lines: readonly StatementLine[]): number =>
  lines.reduce((total, line) => total + line.amount, 0);

/** Drift between the journal's view and the bank's view of one day. */
export const drift = (postings: readonly Posting[], statement: readonly StatementLine[]) => {
  const journalTotal = postings.map(signedAmount).reduce((total, amount) => total + amount);
  return format(money(journalTotal - statementTotal(statement), "usd"));
};
