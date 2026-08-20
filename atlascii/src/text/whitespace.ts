import { type Config, resolve } from "../config/index.ts";

/**
 * Makes trailing whitespace visible, one dot per character.
 *
 * Without it a difference that is *only* trailing whitespace renders as two
 * identical-looking lines, and a reader concludes the tool is broken. Applied
 * per line, so it catches the ends of a multi-line value too.
 */
export const visibleTrailingSpace = (input: { readonly text: string; readonly config?: Config }) =>
  input.text.replace(/\s+$/gm, (spaces) => resolve(input.config).figures.dot.repeat(spaces.length));
