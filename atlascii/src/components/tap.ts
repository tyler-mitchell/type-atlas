import { tapLine, tapYamlText } from "../format/tap.ts";
import { indented } from "../layout/indent.ts";
import type { TapResult } from "../protocol/shapes.ts";

/**
 * A TAP report: version, plan, then one line per result.
 *
 * The plan (`1..n`) comes before the results because a parser uses it to know
 * whether the run was cut short — a report that stops early is only detectable
 * against a count declared up front.
 *
 * Failures carry an indented YAML block, which is where TAP puts detail a
 * parser can read and a human can still follow.
 */
export const tap = (results: readonly TapResult[]): readonly string[] => [
  "TAP version 13",
  `1..${results.length}`,
  ...results.flatMap((result, index) => {
    const line = tapLine({ ...result, number: index + 1 });
    if (!result.detail) return [line];
    const fields = Object.entries(result.detail).map(
      ([name, value]) => `${name}: ${tapYamlText(value)}`,
    );
    return [line, indented({ value: ["---", ...fields, "..."].join("\n") })];
  }),
];
