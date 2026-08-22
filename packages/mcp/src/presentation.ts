import { existsSync } from "node:fs";
import { asciiFigures, type Config, figures, guideNames, pathStyles } from "@type-atlas/atlascii";
import { dirname, join } from "pathe";

/**
 * What this server renders as, read from the environment it was launched with.
 *
 * An MCP server is started by its client from a configuration naming a command,
 * its arguments, and its environment — so the environment is where a client
 * states a preference it holds for the whole session. Nothing here is a
 * per-call choice: a terminal draws box characters or it does not, and a reader
 * wants paths one way for as long as they are reading.
 *
 * Every setting is optional and independent. A client choosing ASCII glyphs
 * says nothing about how depth is drawn or how paths are written, which is why
 * these are separate namespaces rather than one theme name.
 *
 *   TYPE_ATLAS_GLYPHS  unicode | ascii                  what a terminal can draw
 *   TYPE_ATLAS_GUIDE   connectors | indent | markers    how depth is drawn
 *   TYPE_ATLAS_PATHS   workspace | absolute | project   how a file is named
 *
 * `Marks` is deliberately absent, though the library configures it. Its ASCII
 * variant changes exactly two characters — `·` and `—` — and reaches only the
 * lines `rowBranches` composes, because every partial types its own
 * punctuation. Offering it here would advertise a setting that half the tools
 * ignore, and half-working configuration is worse than none. It stays available
 * to a consumer calling the components directly, where it does work.
 *
 * Nothing argues for closing that gap instead: this answer travels as JSON-RPC
 * to a client that renders it, not to a terminal this process can see, so the
 * ASCII set is answering a question the MCP path does not ask.
 *
 * The accepted values come from the library rather than being restated here, so
 * a style added there is accepted here without anyone remembering to.
 *
 * Two conventions were considered and not taken, because the need differs:
 *
 * A CLI decides its glyphs by *detecting* the terminal — `NO_COLOR`,
 * `TERM=dumb`, and the `is-unicode-supported` check behind `figures` and
 * `log-symbols`. That is right when the process writing the characters is the
 * process a human is looking at. Here it is not: this server's answer is
 * carried to a client that renders it somewhere else entirely, so detecting
 * *our* terminal would decide from the wrong machine. The client knows, and
 * says so.
 *
 * `arktype` validates every tool input in this package, and could express these
 * as a union. Its worth is precise errors, and these deliberately have none — a
 * server that refuses to start over a misspelled display preference has turned
 * a cosmetic setting into an outage. Ceremony around a discarded result.
 */
const glyphSets = { unicode: figures, ascii: asciiFigures } as const;

/**
 * One setting, or nothing if it was unset or misspelled.
 *
 * Unrecognised is ignored rather than rejected: a server that refuses to start
 * over a typo in a display preference has turned a cosmetic setting into an
 * outage, and the reader loses every answer instead of one glyph.
 */
const setting = <Value extends string>(
  name: string,
  allowed: readonly Value[],
): Value | undefined => {
  const given = process.env[name]?.trim().toLowerCase();
  return allowed.find((value) => value === given);
};

/**
 * What marks a directory as a project a reader would name a file against.
 *
 * `tsconfig.json` first, because it is what defines a TypeScript project and
 * what `project_config` reports. `package.json` second, so a package with no
 * TypeScript of its own is still a boundary — and so this keeps working for a
 * language whose projects are packages rather than compilations.
 */
const manifests = ["tsconfig.json", "package.json"];

const projectRoots = new Map<string, string | undefined>();

/**
 * The nearest directory above a file that holds a manifest.
 *
 * Reads disk, which is why it lives here rather than in the library that
 * renders the path: finding a project is a fact about the machine, and a
 * presentation library that touched the filesystem would be answering a
 * question it has no business asking.
 *
 * Cached by directory and consulted only when the `project` style is chosen, so
 * a session that did not ask for it pays nothing, and one that did pays once
 * per directory rather than once per path.
 */
const projectRootFor = (file: string): string | undefined => {
  const walk = (directory: string): string | undefined => {
    const held = projectRoots.get(directory);
    if (held !== undefined || projectRoots.has(directory)) return held;
    const parent = dirname(directory);
    const found = manifests.some((manifest) => existsSync(join(directory, manifest)))
      ? directory
      : parent === directory
        ? undefined
        : walk(parent);
    projectRoots.set(directory, found);
    return found;
  };
  return walk(dirname(file));
};

export const presentationFromEnvironment = (): Config => {
  const glyphs = setting("TYPE_ATLAS_GLYPHS", ["unicode", "ascii"] as const);
  return {
    figures: glyphs && glyphSets[glyphs],
    guide: setting("TYPE_ATLAS_GUIDE", guideNames),
    paths: setting("TYPE_ATLAS_PATHS", pathStyles),
    projectRootFor,
  };
};
