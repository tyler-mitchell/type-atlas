/**
 * An inline `{@link X}` the upstream converter split into a tag of its own.
 *
 * `@throws {@link PolicyViolation} when …` arrives as a dangling `{`, a
 * detached `*@link*` heading, and the name wearing a stray `}` — the sentence
 * a maintainer wrote, made unreadable in the answer meant to carry it. The
 * shape is exact enough to repair without touching legitimate content: a
 * brace, the converter's own emphasis-wrapped tag, and the link target.
 */
const splitInlineLink = /\{\s*\*@link(?:code|plain)?\*\s+([^{}]+?)\s*\}/gu;

export const markupText = (contents: unknown): string => {
  if (typeof contents === "string") return contents.replace(splitInlineLink, "$1");
  if (Array.isArray(contents)) return contents.map(markupText).filter(Boolean).join("\n\n");
  if (contents && typeof contents === "object" && "value" in contents) {
    return markupText(String((contents as { readonly value: unknown }).value));
  }
  return "";
};
