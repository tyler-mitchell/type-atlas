import { type Account, normalBalance } from "@ledger/accounts";
import { format, type Money, negate } from "@ledger/money";

/**
 * One rendered statement line. The sign follows the account's normal side:
 * a liability holding a credit balance reads as positive on its statement.
 */
export const statementLine = (account: Account, balance: Money): string => {
  const shown = normalBalance(account.kind) === "credit" ? negate(balance) : balance;
  return `${account.path.padEnd(32)} ${format(shown)}`;
};
