import { type Config, resolve } from "../config/index.ts";
import { width as columnsOf } from "../text/width.ts";

/**
 * A rule, optionally naming the section it opens.
 *
 * Adapted from Vitest's `divider`. Text centres by default; giving `right`
 * anchors it that many columns from the end instead, which is how a run of
 * counters forms a column down the page while a section header stays centred:
 *
 *     ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 *     ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯
 *
 * Vitest reads the terminal width; a transcript has none, so the width comes
 * from the dimensions with the same 80-column default.
 *
 * The text is measured in columns rather than code units. A rule is the one
 * thing on a page whose only job is to reach the margin, so a CJK or emoji
 * title counted by `.length` would overshoot it by exactly the width it added.
 */
export const divider = (input?: {
  readonly text?: string;
  readonly right?: number;
  readonly config?: Config;
}) => {
  const { figures, dimensions } = resolve(input?.config);
  const width = dimensions.ruleWidth;
  const text = input?.text;
  if (!text) return figures.longDash.repeat(width);
  const columns = columnsOf(text);
  const right = input?.right;
  const left = Math.max(
    0,
    right === undefined ? Math.floor((width - columns) / 2) : width - columns - right,
  );
  const end = Math.max(0, width - columns - left);
  return `${figures.longDash.repeat(left)}${text}${figures.longDash.repeat(end)}`;
};
