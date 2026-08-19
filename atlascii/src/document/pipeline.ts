import Markdoc, { type Config } from "@markdoc/markdoc";
import { functions } from "./functions.ts";
import { render } from "./render.ts";
import { tags } from "./tags.ts";

/**
 * A Markdoc configuration carrying this library's components and values.
 *
 * Markdoc merges its own built-ins — `default`, `equals`, `not`, `and`, `or` —
 * with the functions given here, so a document keeps them.
 */
const documentConfig = (partialSources: Record<string, string>): Config => ({
  tags,
  functions,
  partials: Object.fromEntries(
    Object.entries(partialSources).map(([name, source]) => [name, Markdoc.parse(source)]),
  ),
  validation: { validateFunctions: true },
});

/**
 * Absence as a missing key rather than as a key holding nothing.
 *
 * To the validator those are not the same thing. Walking `$callers.groups` it
 * asks `hasOwnProperty` of each step's value, so a *missing* `callers` reports
 * an undefined variable and stops, while a `callers` that is present and
 * `undefined` passes that check and leaves the next step asking
 * `hasOwnProperty` of nothing, which throws before the document has rendered a
 * character.
 *
 * Handlers hand over `undefined` for what an answer does not have — that is
 * what optional means in the shapes they return — so the normalising belongs
 * here, once, rather than in every handler that ever writes a document.
 */
const present = (value: unknown): unknown =>
  Array.isArray(value) || value === null || typeof value !== "object"
    ? value
    : Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, held]) => held !== undefined)
          .map(([name, held]) => [name, present(held)]),
      );

/** One `ask` a composed document declares: an operation and the name it binds. */
export type DocumentAsk = {
  readonly operation: string;
  readonly bind: string;
  readonly attributes: Readonly<Record<string, unknown>>;
};

/**
 * An attribute value that reads another ask's answer: `files=$uses.paths`.
 *
 * The engine's variable node stays behind this entry point; a fulfiller sees
 * only the path it names, and resolves it against what earlier asks bound —
 * which is what lets one query compose over another's result.
 */
export type AskReference = { readonly reference: readonly string[] };

export const isAskReference = (value: unknown): value is AskReference =>
  typeof value === "object" &&
  value !== null &&
  "reference" in value &&
  Array.isArray((value as AskReference).reference);

/**
 * The intelligence a composed document declares it wants, in document order.
 *
 * `ask` tags are declarations, so they are read from the parse rather than
 * discovered during rendering — a fulfiller runs every operation first, then
 * renders once with the answers bound. Reading them here keeps the engine
 * behind this entry point: a fulfiller learns what was asked without ever
 * holding a Markdoc node.
 */
export const documentAsks = (source: string): readonly DocumentAsk[] =>
  [...Markdoc.parse(source).walk()]
    .filter((node) => node.type === "tag" && node.tag === "ask")
    .map((node) => ({
      operation: String(node.attributes.primary ?? ""),
      bind: String(node.attributes.as ?? ""),
      attributes: Object.fromEntries(
        Object.entries(node.attributes as Record<string, unknown>).map(([name, value]) => [
          name,
          value instanceof Markdoc.Ast.Variable
            ? ({ reference: value.path.map(String) } satisfies AskReference)
            : value,
        ]),
      ),
    }));

/**
 * Renders one authored document to text.
 *
 * The whole pipeline — parse, validate, transform, render — behind a signature
 * that names none of it. A caller passes source and the values the document
 * reads, and receives text; nothing in the arguments or the result is a Markdoc
 * type, so the document layer can be replaced without touching a consumer. That
 * is the reason this lives here rather than beside the documents that use it: a
 * consumer that renders documents should depend on this library, not on the
 * engine this library currently renders them with.
 *
 * A document naming a tag or function that does not exist throws. A document
 * naming a *variable* that was not supplied does not: `{% if $total %}` asking
 * about a value the caller had no reason to pass is how a document says "when
 * there is one", and every empty case is written that way.
 */
export const renderDocument = (input: {
  readonly source: string;
  readonly file: string;
  readonly variables: Record<string, unknown>;
  readonly partials?: Record<string, string>;
}): { readonly text: string; readonly undefinedVariables: readonly string[] } => {
  const ast = Markdoc.parse(input.source, { file: input.file });
  // Markdoc reads frontmatter but never parses it, leaving the raw text on the
  // AST for the document's own format to decide. JSON is one Markdoc documents
  // it, and the one that needs nothing to read it. What a document declares
  // about itself belongs to the document, so it arrives as `$frontmatter`
  // rather than as a variable every handler would have to remember to pass.
  const declared = ast.attributes.frontmatter?.trim();
  const frontmatter: unknown = declared?.startsWith("{") ? JSON.parse(declared) : {};
  const config = {
    ...documentConfig(input.partials ?? {}),
    variables: { ...(present(input.variables) as Record<string, unknown>), frontmatter },
  };
  const validation = Markdoc.validate(ast, config);
  const structural = validation.filter((entry) => entry.error.id !== "variable-undefined");
  if (structural.length > 0) {
    throw new Error(
      `${input.file} names something this renderer does not have: ${structural
        .map((entry) => entry.error.message)
        .join("; ")}`,
    );
  }
  // Reported as names rather than as the engine's error objects. A document
  // reading a value nobody passed renders an empty space where a sentence was
  // meant to go, and says nothing about it; a caller that wants to know can
  // check, and nothing in the answer names the engine that found out.
  const undefinedVariables = validation.map(
    (entry) => /Undefined variable: '(.+)'/u.exec(entry.error.message)?.[1] ?? entry.error.message,
  );
  // Blank lines at either end, never the first line's indentation: `trim()` ate
  // the leading spaces of whatever came first, so an aligned block lost its top
  // row's column while every row under it kept one.
  const text = render(Markdoc.transform(ast, config))
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\s+$/, "");
  return { text, undefinedVariables };
};
