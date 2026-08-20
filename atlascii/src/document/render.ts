import Markdoc, { type RenderableTreeNode, type Tag } from "@markdoc/markdoc";

// Markdoc ships CommonJS, so its *values* must come off the default export —
// naming them in the import list type-checks and then throws under Node, which
// a bundler-backed test run does not reveal. Type imports are erased, so `Tag`
// as a type is safe to name; only the runtime `isTag` goes through the namespace.
const isTag = (node: RenderableTreeNode): node is Tag => Markdoc.Tag.isTag(node);

/**
 * A text renderer for Markdoc.
 *
 * Markdoc ships `renderers.html` and `renderers.react` and nothing for plain
 * text. This is that renderer, and it implements Markdoc's own node vocabulary
 * — the tags `Markdoc.transform` already emits — rather than a vocabulary of
 * our own. A component returns `p`, `ul`, `li`, `h2`; anything that reads a
 * Markdoc tree can read it, and a document written in plain Markdown renders
 * here without a component being involved at all.
 *
 * Nesting is `ul`/`li`, which is how Markdoc already models it: a list inside a
 * list item indents, and no component has to know its own depth.
 */

/**
 * Containers separate their children with a blank line. Everything else runs
 * its children together — a paragraph's children are inline, which is why
 * `{% time(4502) %} · {% width("東京") %}` is one line and not three.
 */
const containers = new Set(["article", "blockquote"]);

const headingLevels: Readonly<Record<string, number>> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

const indentBy = (value: string, columns: number) =>
  value
    .split("\n")
    .map((row) => (row ? `${" ".repeat(columns)}${row}` : row))
    .join("\n");

const renderChildren = (children: readonly RenderableTreeNode[], depth: number): string[] =>
  children.map((child) => render(child, depth)).filter((part) => part !== "");

export const render = (node: RenderableTreeNode, depth = 0): string => {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return renderChildren(node, depth).join("");
  if (!isTag(node)) return "";

  const { name } = node;
  if (name === "hr") return "";
  // Markdoc's own line break. A component stacking lines inside one block uses
  // this rather than a list, so an authored list keeps its markers.
  if (name === "br") return "\n";

  // A list marks its items; a list inside an item indents under it.
  if (name === "ul" || name === "ol") {
    const items = node.children.map((child, index) => {
      const marker = name === "ol" ? `${index + 1}. ` : "- ";
      const rendered = render(child, depth + 1);
      return rendered.startsWith(" ") || rendered === "" ? rendered : `${marker}${rendered}`;
    });
    const stacked = items.filter((item) => item !== "").join("\n");
    return depth === 0 ? stacked : indentBy(stacked, 2);
  }
  if (name === "li") return renderChildren(node.children, depth).join("\n");

  const parts = renderChildren(node.children, depth);
  if (parts.length === 0) return "";

  const level = headingLevels[name];
  if (level !== undefined) return `${"#".repeat(level)} ${parts.join("")}`;

  return parts.join(containers.has(name) ? "\n\n" : "");
};
