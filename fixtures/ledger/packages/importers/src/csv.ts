import { Journal, type Entry, credit, debit, type AccountPath } from "@ledger/accounts";
import { type Currency, isCurrency, money, zero, format } from "@ledger/money";
import type { Posting } from "@ledger/accounts";

/** One parsed row of a bank's CSV export. */
export interface StatementRow {
  readonly postedOn: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: Currency;
}

const HEADER = "date,description,amount,currency";

export const parseStatement = (source: string): readonly StatementRow[] => {
  const [head, ...rows] = source.trim().split("\n");
  if (head !== HEADER) throw new Error(`Unexpected header: ${head}`);
  return rows.map((row) => {
    const [postedOn, description, amount, currency] = row.split(",");
    if (!postedOn || !description || !amount || !currency || !isCurrency(currency)) {
      throw new Error(`Unparseable row: ${row}`);
    }
    return { postedOn, description, amountMinor: Number(amount), currency };
  });
};

/** Record every statement row against one bank account, balanced into suspense. */
export const importStatement = (
  journal: Journal<{ importedFrom: string }>,
  rows: readonly StatementRow[],
  account: AccountPath,
): number => {
  for (const row of rows) {
    const amount = money(Math.abs(row.amountMinor), row.currency);
    const postings: readonly Posting[] =
      row.amountMinor >= 0
        ? [debit(account, amount), credit("suspense", amount)]
        : [credit(account, amount), debit("suspense", amount)];
    journal.post({
      recordedAt: new Date(row.postedOn),
      description: row.description,
      postings,
      meta: { importedFrom: "csv" },
    });
  }
  return rows.length;
};
