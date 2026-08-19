import { type Config, resolve } from "../config/index.ts";
import { translate } from "../config/messages.ts";

export type CountState = { readonly name: string; readonly count: number };

/**
 * A count line naming only the states that occurred.
 *
 * The rule worth keeping from Vitest's `getStateString`: a row never prints a
 * zero. `2 failed | 6 passed (8)`, never `2 failed | 0 skipped | 6 passed`.
 *
 * `counts.empty` is what to say when nothing occurred, because "none" is a word
 * and words belong to the catalog.
 */
export const counts = (input: {
  readonly states: readonly CountState[];
  readonly total?: number;
  readonly config?: Config;
}) => {
  const { marks, messages } = resolve(input.config);
  const named = input.states.filter((state) => state.count > 0);
  return named.length === 0
    ? translate({ key: "counts.empty", messages })
    : `${named.map((state) => `${state.count} ${state.name}`).join(marks.countJoin)}${
        input.total === undefined ? "" : `${marks.totalOpen}${input.total}${marks.totalClose}`
      }`;
};
