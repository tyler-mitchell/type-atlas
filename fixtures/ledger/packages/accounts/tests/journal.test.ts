import { money } from "@ledger/money";
import { expect, test } from "vite-plus/test";
import { credit, debit, Journal, UnbalancedEntryError } from "../src/index.ts";

test("posts a balanced transfer through the overload", () => {
  const journal = new Journal<undefined>();
  const entry = journal.post(
    "office chair",
    { from: "assets:bank:checking", to: "expenses:furniture", amount: money(24900, "USD") },
    undefined,
  );
  expect(entry.postings).toHaveLength(2);
  expect(journal.history("expenses:furniture")).toHaveLength(1);
});

test("refuses an unbalanced entry", () => {
  const journal = new Journal<undefined>();
  expect(() =>
    journal.post({
      recordedAt: new Date(),
      description: "typo in the credit side",
      postings: [
        debit("expenses:travel", money(5000, "USD")),
        credit("assets:bank:checking", money(500, "USD")),
      ],
      meta: undefined,
    }),
  ).toThrow(UnbalancedEntryError);
});
