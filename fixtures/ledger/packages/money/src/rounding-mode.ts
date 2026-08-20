/** How sub-minor precision resolves when a statement and the books disagree. */
export enum RoundingMode {
  HalfUp = "half-up",
  HalfEven = "half-even",
  Truncate = "truncate",
}

/** Per-institution conventions, as observed in their exports. */
const bankRounding: Readonly<Record<string, RoundingMode>> = {
  "first-national": RoundingMode.HalfEven,
  "harbor-credit": RoundingMode.HalfUp,
};

export const roundingModeOf = (bank: string): RoundingMode =>
  bankRounding[bank] ?? RoundingMode.HalfEven;
