/**
 * A Codex patch: files, their moves, and the hunks changing them.
 *
 * A wire format, which is why it sits beside the other formats rather than
 * among the components. Nothing here is a presentation choice — `*** Begin
 * Patch` and `@@` are the format's own words, a reader never configures them,
 * and a document could not express a diff even if one wanted to. What a caller
 * supplies is the change; what comes back is the encoding of it.
 */
export type PatchFile = {
  readonly file: string;
  /** Where the file ends up, when the change moves it. */
  readonly movedTo?: string;
  /** Each hunk's diff lines, already marked with their leading space, `-`, or `+`. */
  readonly hunks: readonly (readonly string[])[];
};

export const codexPatch = (files: readonly PatchFile[]): string =>
  [
    "*** Begin Patch",
    ...files.flatMap((file) => [
      `*** Update File: ${file.file}`,
      ...(file.movedTo === undefined ? [] : [`*** Move to: ${file.movedTo}`]),
      ...file.hunks.flatMap((hunk) => ["@@", ...hunk]),
    ]),
    "*** End Patch",
  ].join("\n");
