import { type Config, resolve } from "../config/index.ts";

/**
 * A duration, in the shape a test reporter prints one.
 *
 * Taken from Vitest's `formatTime`: past a second, a count of milliseconds
 * stops being a number a reader compares and becomes one they parse, so it
 * becomes seconds to two decimals.
 */
export const formatTime = (milliseconds: number) =>
  milliseconds > 1000 ? `${(milliseconds / 1000).toFixed(2)}s` : `${Math.round(milliseconds)}ms`;

/** The clock time of a moment, without its date. */
export const timeOfDay = (at: Date) => at.toTimeString().split(" ")[0] ?? "";

/**
 * A share of a whole, floored at one percent.
 *
 * A sub-one-percent share rounds to `1%` rather than a misleading `0%`, because
 * something that took measurable time should not read as having taken none.
 */
export const percent = (share: number) => `${Math.max(1, Math.round(share))}%`;

export type TimedPart = { readonly name: string; readonly milliseconds: number };

/**
 * Where time went, as shares rather than durations: `transform 42%, setup 8%`.
 *
 * Parts under half a percent are dropped and the rest ordered by time spent, so
 * the line names what a reader would act on and not everything that happened.
 */
export const shares = (input: {
  readonly parts: readonly TimedPart[];
  readonly config?: Config;
}) => {
  const { marks } = resolve(input.config);
  const total = input.parts.reduce((sum, part) => sum + part.milliseconds, 0);
  return total <= 0
    ? ""
    : input.parts
        .map((part) => ({ name: part.name, share: (part.milliseconds / total) * 100 }))
        .filter((part) => part.share >= 0.5)
        .sort((left, right) => right.share - left.share)
        .map((part) => `${part.name} ${percent(part.share)}`)
        .join(marks.listJoin);
};

/**
 * A breakdown of where time went: `transform 84ms, collect 1.21s`.
 *
 * Only the parts that took time are named, the same rule a count line follows.
 * The formatter is given rather than chosen here, so a caller decides what a
 * duration looks like.
 */
export const breakdown = (input: {
  readonly parts: readonly TimedPart[];
  readonly format: (milliseconds: number) => string;
  readonly config?: Config;
}) =>
  input.parts
    .filter((part) => part.milliseconds > 0)
    .map((part) => `${part.name} ${input.format(part.milliseconds)}`)
    .join(resolve(input.config).marks.listJoin);
