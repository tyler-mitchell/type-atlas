/**
 * The Markdoc adapter.
 *
 * Everything that knows Markdoc exists lives behind this entry point and
 * nothing else in the library imports it. The components are values in, lines
 * out; this turns them into a document layer for callers who want one, and a
 * caller who does not want one never loads Markdoc by importing `@type-atlas/atlascii`.
 *
 * That separation is the point. Documents are one way to compose these
 * components, and the day this library composes them another way, this
 * directory is what changes.
 */
export {
  type AskReference,
  type DocumentAsk,
  documentAsks,
  isAskReference,
  renderDocument,
} from "./pipeline.ts";
export { render } from "./render.ts";
export { tags } from "./tags.ts";
export { functions } from "./functions.ts";
