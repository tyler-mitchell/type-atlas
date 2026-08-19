import { command } from "../format/command.ts";
import type { Annotation } from "../protocol/shapes.ts";

/**
 * GitHub workflow annotations: one command per problem.
 *
 * A problem without a location still gets a command — the message is the point,
 * and omitting the annotation entirely would lose it. Absent properties are
 * left out rather than emitted empty, since GitHub reads `file=` as a literal
 * empty path.
 */
export const annotations = (input: {
  readonly problems: readonly Annotation[];
  readonly kind?: string;
}): readonly string[] =>
  input.problems.map((problem) =>
    command({
      kind: input.kind ?? "error",
      message: problem.message,
      properties: {
        file: problem.file,
        line: problem.line,
        col: problem.column,
        title: problem.title,
      },
    }),
  );
