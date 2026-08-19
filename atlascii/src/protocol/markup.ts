export const markupText = (contents: unknown): string => {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(markupText).filter(Boolean).join("\n\n");
  if (contents && typeof contents === "object" && "value" in contents) {
    return String((contents as { readonly value: unknown }).value);
  }
  return "";
};
