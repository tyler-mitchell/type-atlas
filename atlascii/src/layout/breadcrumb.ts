import { type Config, resolve } from "../config/index.ts";

/**
 * A path joined to a nested name, reading the same at one segment or four.
 *
 * Adapted from Vitest's console label (`stdout | file > suite > nested`). Two
 * ideas carry over. The kind leads, so a reader scanning a wall of output finds
 * the one they want without reading any of it. And the location is a file
 * joined to a nested path by a single separator, which is the same shape a
 * symbol path or a call hierarchy wants.
 *
 * Both joiners come from the marks. They were literals here, which made the
 * one component whose whole subject is a separator the one component that could
 * not change it.
 *
 * The file is optional because containment does not always start at one. A
 * symbol path inside a file — `outer › inner › leaf`, named beside the file
 * rather than under it — is the same trail with nothing at its head, and
 * requiring a first segment is what sent its one live caller off to join the
 * names itself with a separator this library had never heard of.
 */
export const breadcrumb = (input: {
  readonly kind?: string;
  readonly file?: string;
  readonly path?: readonly string[];
  readonly config?: Config;
}) => {
  const { marks } = resolve(input.config);
  const trail = [...(input.file === undefined ? [] : [input.file]), ...(input.path ?? [])].join(
    marks.trail,
  );
  return input.kind ? `${input.kind}${marks.channel}${trail}` : trail;
};
