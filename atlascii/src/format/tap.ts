/**
 * TAP: the Test Anything Protocol's escaping and result line.
 *
 * `#` starts a directive, so a name containing one has to escape it or a parser
 * reads the rest of the line as a comment. Newlines end a result, so they are
 * flattened rather than escaped.
 */
export const tapText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/#/g, "\\#").replace(/\n/g, " ");

/** TAP diagnostic YAML: quoted, inner quotes escaped. */
export const tapYamlText = (value: string | undefined) =>
  value ? `"${value.replace(/"/g, '\\"')}"` : "";

/**
 * One TAP result line.
 *
 * `ok`/`not ok`, the number, the name, then a directive or a duration — the
 * order a TAP parser expects, with the comment marker escaped out of the name.
 */
export const tapLine = (input: {
  readonly ok: boolean;
  readonly number: number;
  readonly name: string;
  readonly directive?: "SKIP" | "TODO";
  readonly milliseconds?: number;
}) => {
  const comment = input.directive
    ? ` # ${input.directive}`
    : input.milliseconds === undefined
      ? ""
      : ` # time=${input.milliseconds}ms`;
  return `${input.ok ? "ok" : "not ok"} ${input.number} - ${tapText(input.name)}${comment}`;
};
