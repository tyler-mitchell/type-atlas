import { type Config, resolve } from "../config/index.ts";
import { translate } from "../config/messages.ts";
import type { DiffChunk } from "../protocol/shapes.ts";
import { noun } from "../text/plural.ts";

type DiffLine = { readonly kind: DiffChunk["kind"]; readonly text: string };

/**
 * Which lines survive: every change, and `context` unchanged lines around each.
 *
 * A set of kept indexes rather than a walk with a running counter, because the
 * windows around neighbouring changes overlap and a run between two changes is
 * kept from both ends at once. Taking the union says that in one expression;
 * deciding it while walking means tracking how far the last change still
 * reaches.
 */
const keptLines = (lines: readonly DiffLine[], context: number) => {
  // Bounded by the diff's own length before it is used as an array length: a
  // caller asking for unbounded context is asking for every line, and
  // `Array.from({ length: Infinity })` throws rather than obliging.
  const reach = Math.max(0, Math.min(context, lines.length));
  return new Set(
    lines.flatMap((line, index) =>
      line.kind === "common"
        ? []
        : Array.from({ length: reach * 2 + 1 }, (_, offset) => index - reach + offset),
    ),
  );
};

/**
 * A difference between two versions, as unified lines.
 *
 * Takes chunks that are already computed. Which algorithm produced them is not
 * a formatting question, and a library that renders text should not carry a
 * Myers implementation to answer one.
 *
 * The annotations head the block and the markers lead each line, so a reader
 * knows which side they are looking at before reading any value. The words come
 * from the catalog and the markers from the marks, because `Expected` is
 * language and `-` is convention.
 *
 * Unchanged lines far from any change are not shown. A diff exists to say what
 * moved, and printing both versions whole to report two changed lines buries
 * the answer in its own evidence — so runs of unchanged lines beyond `context`
 * collapse to one line saying how many were left out. The count is stated
 * rather than implied: a gap a reader cannot size is a gap they have to go and
 * measure. `context: Infinity` shows everything.
 *
 * Returns the annotation block and the body separately, because they stand
 * apart — deciding that spacing here would take it from the document.
 */
export const diff = (input: {
  readonly chunks: readonly DiffChunk[];
  readonly context?: number;
  readonly config?: Config;
}): readonly (readonly string[])[] => {
  const { marks, messages, dimensions } = resolve(input.config);
  const markers = {
    removed: marks.diffRemoved,
    added: marks.diffAdded,
    common: marks.diffCommon,
  };
  const lines: readonly DiffLine[] = input.chunks.flatMap((chunk) =>
    chunk.lines.map((text) => ({ kind: chunk.kind, text })),
  );
  if (lines.length === 0) return [];
  const gap = (omitted: number) =>
    omitted === 0
      ? []
      : [
          `${marks.diffHunk} ${translate({
            key: "diff.omitted",
            messages,
            // The message selects its own form. A caller that picked one and
            // passed it back in was deciding grammar on the message's behalf,
            // and could only ever offer the two forms English has.
            values: { count: omitted },
          })}`,
        ];
  const kept = keptLines(lines, input.context ?? dimensions.diffContext);
  const body = lines.reduce<{ readonly rows: readonly string[]; readonly omitted: number }>(
    (state, line, index) =>
      kept.has(index)
        ? {
            rows: [...state.rows, ...gap(state.omitted), `${markers[line.kind]} ${line.text}`],
            omitted: 0,
          }
        : { ...state, omitted: state.omitted + 1 },
    { rows: [], omitted: 0 },
  );
  // A run reaching the end is a gap too. Nothing follows it to trigger the
  // marker, and a diff that simply stopped reads as a diff that ended.
  const rows = [...body.rows, ...gap(body.omitted)];
  return [
    [
      `${markers.removed} ${translate({ key: "diff.expected", messages })}`,
      `${markers.added} ${translate({ key: "diff.received", messages })}`,
    ],
    rows,
  ];
};
