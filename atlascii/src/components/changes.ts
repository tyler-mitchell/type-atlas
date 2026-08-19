import type { ChangeGroup } from "../protocol/shapes.ts";
import { type Config, resolve } from "../config/index.ts";
import { hierarchy, markerGuide } from "../layout/hierarchy.ts";

/**
 * Files grouped by what happened to them, each with its own keys beneath.
 *
 * Markers rather than connectors: the levels mean different things — a heading,
 * a file, a key within it — so a glyph per level says which is which, where a
 * connector would only say that something is nested.
 *
 * A group nothing happened to is left out entirely, the same rule a count line
 * follows: never print a zero.
 */
export const changes = (input: {
  readonly groups: readonly ChangeGroup[];
  readonly config?: Config;
}): readonly (readonly string[])[] => {
  const glyphs = resolve(input.config).figures;
  return input.groups
    .filter((group) => group.files.length > 0)
    .map((group) =>
      hierarchy({
        branches: [
          {
            label: group.title,
            children: group.files.map((file) => ({
              label: file.path,
              children: (file.keys ?? []).map((key) => ({ label: key })),
            })),
          },
        ],
        guide: markerGuide({ marks: [glyphs.downRight, glyphs.dot] }),
      }),
    );
};
