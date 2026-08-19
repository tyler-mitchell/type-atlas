/** Indents a block by a level, the way a nested writer would. */
export const indented = (input: {
  readonly value: string;
  readonly level?: number;
  readonly unit?: string;
}) =>
  input.value
    .split("\n")
    .map((line) => (line ? `${(input.unit ?? "    ").repeat(input.level ?? 1)}${line}` : line))
    .join("\n");
