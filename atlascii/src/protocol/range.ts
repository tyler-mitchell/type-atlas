/**
 * Positions and ranges as text.
 *
 * The Language Server Protocol counts lines and characters from zero; a source
 * location is written and read from one. That conversion happens here and
 * nowhere else, so a component receives the position the protocol gave it and
 * every rendered `line:column` in this library agrees.
 */
export type Position = { readonly line: number; readonly character: number };
export type Range = { readonly start: Position; readonly end: Position };

export const positionText = ({ line, character }: Position) => `${line + 1}:${character + 1}`;

export const rangeText = ({ start, end }: Range) => `${positionText(start)}-${positionText(end)}`;

export const containsPosition = (range: Range, position: Position) =>
  (position.line > range.start.line ||
    (position.line === range.start.line && position.character >= range.start.character)) &&
  (position.line < range.end.line ||
    (position.line === range.end.line && position.character <= range.end.character));

/** Whether two ranges cover the same span, so one need not be named twice. */
export const sameRange = (left: Range, right: Range) =>
  left.start.line === right.start.line &&
  left.start.character === right.start.character &&
  left.end.line === right.end.line &&
  left.end.character === right.end.character;
