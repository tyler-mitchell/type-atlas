import { type Money, money } from "@ledger/money";

/**
 * A parity check from an abandoned rounding experiment: nothing imports it,
 * and the production rounding table it asserted against was removed. It
 * survives only here — the residue a successor search must not mistake for
 * a living capability.
 */
export const assertRoundingParity = (left: Money, right: Money): void => {
  if (left.minorUnits !== right.minorUnits || left.currency !== right.currency) {
    throw new Error(`rounding parity violated: ${String(left.minorUnits)} != ${String(right.minorUnits)}`);
  }
};

export const paritySamples: readonly Money[] = [money(1n, "USD"), money(99n, "USD")];
