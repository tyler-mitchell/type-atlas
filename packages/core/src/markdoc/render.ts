import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDocument as renderSource } from "atlascii/document";

const here = dirname(fileURLToPath(import.meta.url));
const sources = new Map<string, Promise<string>>();

/** Reads an authored document once; they are shipped source, not runtime state. */
const documentSource = (name: string) => {
  const held = sources.get(name);
  if (held) return held;
  const reading = readFile(join(here, name), "utf8");
  sources.set(name, reading);
  return reading;
};

const shared = new Map<string, Promise<Record<string, string>>>();

/**
 * Every partial this package ships, available to every document it renders.
 *
 * A partial is the body of a repeated block, so which document reaches for
 * which one is the document's business rather than a wiring decision made per
 * call site. Read once, like the documents themselves.
 */
const partialSources = () => {
  const held = shared.get("partials");
  if (held) return held;
  const reading = readdir(join(here, "partials")).then(async (names) =>
    Object.fromEntries(
      await Promise.all(
        names
          .filter((name) => name.endsWith(".mdoc"))
          .map(async (name) => [name, await documentSource(join("partials", name))] as const),
      ),
    ),
  );
  shared.set("partials", reading);
  return reading;
};

/*
 * A rendered-output check was tried here and removed. It looked for the marks a
 * sentence leaves when a value it named never arrived — `2 actions at  in ,
 * under .` reads as an answer while stating nothing.
 *
 * It broke `read_file` three times. Every pattern that catches a missing value
 * also occurs in the content this surface renders: `undefined` is a TypeScript
 * type name, a trailing `:` ends half the lines of an object type, and `··`
 * appears in a test fixture for the separator itself. Scoping it to documents
 * that compose every character failed too, because a document delegates its
 * source excerpt to a partial and the guard only saw the document.
 *
 * The lesson is worth more than the check: an answer that carries verbatim
 * content cannot be validated by looking at the answer, because any vocabulary
 * precise enough to find a hole is vocabulary the content may legitimately use.
 * Holes are caught where the values are assembled, or by reading the output.
 */

/**
 * Renders one of this package's authored documents by name.
 *
 * What is left here is the catalogue: which documents exist, where they are on
 * disk, and which partials they share. Rendering itself belongs to `atlascii`,
 * so this file names no document engine and neither does anything downstream of
 * it — replacing the engine is a change inside that library.
 */
export const renderDocument = async (input: {
  readonly document: string;
  readonly variables: Record<string, unknown>;
}) => {
  const [source, partials] = await Promise.all([
    documentSource(join("documents", input.document)),
    partialSources(),
  ]);
  return renderSource({ source, file: input.document, variables: input.variables, partials });
};
