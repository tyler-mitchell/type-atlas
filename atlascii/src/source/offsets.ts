/**
 * Conversion between a source position and a character offset.
 *
 * Pure arithmetic over text — no rendering, no terminal, no domain. Every
 * caret, span, and window in this library resolves through here, so the
 * newline width is decided once: a source containing CRLF counts two
 * characters per line ending, and getting that wrong moves every caret in the
 * file by one per preceding line.
 *
 * Positions are one-based, the way a source location is written and read.
 * Offsets are zero-based, the way a string is indexed.
 */

export const lineSplit = /\r?\n/;

/** The newline width a source uses, in characters. */
export const newlineWidth = (source: string) => (/\r\n/.test(source) ? 2 : 1);

/** Cumulative offset at the end of each line, including its line ending. */
const lineEnds = (source: string) => {
  const width = newlineWidth(source);
  return source
    .split(lineSplit)
    .reduce<readonly number[]>(
      (ends, line) => [...ends, (ends.at(-1) ?? 0) + line.length + width],
      [],
    );
};

/** The offset a line begins at. One-based line. */
export const lineStartOffset = (input: { readonly source: string; readonly line: number }) =>
  input.line <= 1 ? 0 : (lineEnds(input.source)[input.line - 2] ?? 0);

/** The offset a one-based line and column names, clamped to the source length. */
export const positionToOffset = (input: {
  readonly source: string;
  readonly line: number;
  readonly character: number;
}) =>
  input.line > input.source.split(lineSplit).length
    ? input.source.length
    : lineStartOffset(input) + input.character;

/** The one-based line an offset falls on. */
export const offsetToLine = (input: { readonly source: string; readonly offset: number }) => {
  const ends = lineEnds(input.source);
  const index = ends.findIndex((end) => end >= input.offset);
  return index < 0 ? ends.length : index + 1;
};
