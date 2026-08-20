/**
 * Everything a consumer can configure, in one place.
 *
 * Four kinds, deliberately kept apart rather than merged into one settings
 * blob, because they answer to different things:
 *
 *   messages    words       translated per language
 *   figures     glyphs      chosen by what a terminal can draw
 *   marks       punctuation format convention, neither of the above
 *   dimensions  numbers     how wide the terminal is, how much context to show
 *   guide       structure   how depth is drawn
 *   paths       locations   what a file is called in the answer
 *
 * A German catalog, an ASCII glyph set, and a narrow terminal are independent
 * choices; a consumer matching an existing log format changes marks alone.
 * Merging them would make every such choice a fork of the whole object — the
 * ASCII set proves it, overriding two entries of one namespace and nothing in
 * the other three.
 *
 * The guide is named rather than held, because it is the one setting that is
 * a function: naming it keeps this object something a document can pass in an
 * attribute, and lets the name resolve against the glyphs and widths beside it
 * instead of being built from whatever a call site remembered to hand over.
 */
import { defaultDimensions, type Dimensions } from "./dimensions.ts";
import { type Figures, figures } from "./figures.ts";
import { type GuideName, guideFor } from "./guides.ts";
import { defaultMarks, type Marks } from "./marks.ts";
import { defaultMessages, type Messages } from "./messages.ts";
import { defaultVendorDirectories, type PathStyle, type VendorDirectories } from "./paths.ts";

/**
 * The four namespaces, as one thing to pass.
 *
 * They stay separate types — a German catalog and an ASCII glyph set are still
 * independent choices — but a consumer making those choices should make them
 * once, not thread four optional arguments through every call. This is a
 * container for them, not a merge of them.
 *
 * Every field is optional and falls back to its own default, so a caller
 * setting one namespace says nothing about the other three.
 */
export type Config = {
  readonly messages?: Messages;
  readonly figures?: Figures;
  readonly marks?: Marks;
  readonly dimensions?: Dimensions;
  readonly guide?: GuideName;
  readonly paths?: PathStyle;
  readonly vendored?: VendorDirectories;
  /**
   * Which project a file belongs to, for the `project` style.
   *
   * Supplied by the host rather than passed per call, because a project
   * boundary is found on disk and this library does not read one — and because
   * a path rendering is asked for in ninety places that have no way to know.
   * Host-only in practice: markup cannot express a function, so a document
   * passing `config` never carries this.
   *
   * Returning nothing means the file belongs to no project the host knows, and
   * the workspace answers instead.
   */
  readonly projectRootFor?: (file: string) => string | undefined;
};

/**
 * What a host chose for this process, for everything that did not name its own.
 *
 * A consumer's choices are made once — a terminal draws box characters or it
 * does not — and are read in dozens of places that have no business carrying
 * them. Threading a config object through every component, every layout, and
 * every path rendering would put a parameter nobody reads into ninety call
 * sites, and the one that forgot it would silently answer in a different style
 * from its neighbours. That is the failure this exists to prevent.
 *
 * Set once, at start, before anything renders. Not state the program reasons
 * about: an explicit argument still wins everywhere, per namespace, so a caller
 * that does care is never overruled by a caller that did not.
 */
const chosen: { current: Config } = { current: {} };

/**
 * Names what this process renders as, for callers that state nothing.
 *
 * A deviation, recorded as one. The pattern a modern library reaches for is a
 * configured instance — `pino({…})`, `new Chalk({…})`, and this repository's
 * own `createTypeAtlas`, `createSemble`, `createQuorl` — because two consumers
 * in one process can then disagree, and because nothing needs resetting between
 * tests. Module state buys none of that, and the reset hook a test needs here
 * is the honest tell.
 *
 * It is chosen anyway, for one reason: the settings are read in about ninety
 * leaf positions that take a URI and a root and have no business holding a
 * renderer. Threading an instance to all of them puts a parameter nobody reads
 * into every one, and the single site that forgot it would answer in a
 * different style from its neighbours — the divergence this whole namespace
 * exists to prevent, reintroduced by the mechanism meant to prevent it.
 *
 * The narrow thing that makes it truthful: an MCP server is one process serving
 * one client with one presentation, decided before the first answer and never
 * again. A consumer needing two at once has outgrown this and should be given
 * the instance instead.
 */
export const configurePresentation = (config: Config) => {
  chosen.current = config;
};

/**
 * The settings in force, resolved. What a component uses when given nothing.
 *
 * Three layers, narrowest first: what this call named, what the host chose,
 * what the library defaults to.
 *
 * `guide` arrives as a name and leaves as the guide itself, drawn from the
 * glyphs and dimensions resolved alongside it — so a consumer choosing the
 * ASCII set gets ASCII connectors without naming them twice.
 *
 * Connectors are the default because they are the only style that stays
 * unambiguous past one level and the only one that shows where a group ends.
 * Everything this library renders is read by something scanning for structure,
 * and a drawn branch is the structure made visible.
 */
export const resolve = (config?: Config) => {
  const host = chosen.current;
  const figureSet = config?.figures ?? host.figures ?? figures;
  const dimensions = config?.dimensions ?? host.dimensions ?? defaultDimensions;
  return {
    messages: config?.messages ?? host.messages ?? defaultMessages,
    figures: figureSet,
    marks: config?.marks ?? host.marks ?? defaultMarks,
    dimensions,
    guide: guideFor(config?.guide ?? host.guide ?? "connectors", {
      figures: figureSet,
      dimensions,
    }),
    // Workspace-relative by default: a path is read against the root the caller
    // named, and repeating that root on every line costs more than it tells.
    paths: config?.paths ?? host.paths ?? "workspace",
    vendored: config?.vendored ?? host.vendored ?? defaultVendorDirectories,
    projectRootFor: config?.projectRootFor ?? host.projectRootFor,
  };
};

export { defaultDimensions, type Dimensions, narrowDimensions } from "./dimensions.ts";
export { asciiFigures, type Figures, figures } from "./figures.ts";
export { type GuideName, guideFor, guideNames } from "./guides.ts";
export {
  defaultVendorDirectories,
  type PathStyle,
  pathStyles,
  type VendorDirectories,
} from "./paths.ts";
export { defaultMessages, type Messages, translate } from "./messages.ts";
export { asciiMarks, defaultMarks, type Marks } from "./marks.ts";
