import type { Range } from "./range.ts";

/**
 * What each component is given.
 *
 * These are the library's real interface. A caller shaping data for a document
 * is writing one of these, and should be able to say so in its own types
 * without importing a component registry to do it — which is why they live
 * here rather than beside the tags that consume them.
 *
 * Every one takes the protocol's own values. A `Range` stays a `Range`; nothing
 * arrives pre-rendered, because a caller that formatted a range before passing
 * it would be doing the library's job and would need its own copy of the
 * zero-based-to-one-based conversion.
 */

/**
 * A place, and what stands there.
 *
 * One shape whether a file heads a level or a location sits on its own line,
 * because grouping is a judgement about the data — thirteen uses in one module
 * repeat forty characters thirteen times, one use in a module does not — and a
 * separate type per outcome would make that judgement a fork in every consumer
 * that renders one.
 *
 * A position is the minimum. The rest is what a reader needs to act without
 * opening the file: the name declared there, the extent it spans when that
 * differs from the identifier, a trailing note, and the source line itself.
 * Every one of these was rendered by a consumer that could not express it here
 * and wrote its own row instead.
 *
 * `children`, the same name every other nested shape uses, because the guide
 * that draws depth reads that one relation. A node naming them something of its
 * own can only be nested by markup written for that word, which is what left
 * this shape indented by hand while its siblings were drawn.
 */
export type LocationNode = {
  readonly file?: string;
  readonly selection?: Range;
  readonly range?: Range;
  readonly name?: string;
  /**
   * The protocol's number, not a word.
   *
   * Which word stands for kind 12 is the message catalog's, reached by the
   * document that renders the row. A caller resolving it first puts the answer
   * beyond renaming and beyond translation.
   */
  readonly kind?: number;
  readonly within?: string;
  readonly detail?: string;
  readonly text?: string;
  readonly children?: readonly LocationNode[];
};

/**
 * A place to go, with the extent of what is there.
 *
 * LSP's own shape: `targetSelectionRange` is the identifier a reader jumps to,
 * `targetRange` is the whole declaration. `definition`, `typeDefinition`, and
 * `implementation` all answer with this, which is why it is named for the shape
 * rather than for any one of the three requests that return it.
 */
export type LocationLink = {
  readonly file: string;
  readonly selection: Range;
  readonly range?: Range;
  /**
   * What stands at the target.
   *
   * A jump target answered as coordinates alone makes a reader open the file to
   * learn the one thing they asked for: `type_definitions` reported
   * `src/config/marks.ts:14:21` without ever saying the type is `Marks`.
   */
  readonly name?: string;
};

export type CallGroup = {
  readonly file: string;
  readonly targets: readonly {
    readonly name: string;
    readonly kind: string;
    readonly selection: Range;
    readonly range?: Range;
    readonly sites: readonly Range[];
    /**
     * Where the calls happen, when that is not where the callable is declared.
     *
     * Callers are grouped by the file that declares them, but a caller declared
     * in one file can call from another. Naming the site's file only when it
     * differs keeps the common case free of a path repeated on every row.
     */
    readonly siteFile?: string;
    /** What the callable is, when a name alone does not say it. */
    readonly detail?: string;
  }[];
};

export type DocumentSymbol = {
  readonly name: string;
  readonly kind: string;
  readonly selection: Range;
  readonly range?: Range;
  readonly detail?: string;
  readonly depth?: number;
};

export type WorkspaceSymbol = {
  readonly name: string;
  readonly kind: string;
  readonly file: string;
  readonly range?: Range;
  readonly container?: string;
  readonly deprecated?: boolean;
};

export type Diagnostic = {
  readonly file?: string;
  readonly severity?: number;
  readonly source?: string;
  readonly code?: string | number;
  readonly range: Range;
  readonly message: string;
  readonly frame?: string;
};

export type ChangeGroup = {
  readonly title: string;
  readonly files: readonly { readonly path: string; readonly keys?: readonly string[] }[];
};

export type DiffChunk = {
  readonly kind: "removed" | "added" | "common";
  readonly lines: readonly string[];
};

export type StackFrame = {
  readonly name?: string;
  readonly file: string;
  readonly line: number;
  readonly character: number;
};

export type TapResult = {
  readonly ok: boolean;
  readonly name: string;
  readonly directive?: "SKIP" | "TODO";
  readonly milliseconds?: number;
  readonly detail?: Readonly<Record<string, string>>;
};

export type Annotation = {
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly title?: string;
};

/**
 * Severity names, by the protocol's numbering.
 *
 * A default, not a fixture. The protocol assigns numbers; the words are a
 * reader's, and a library that baked English here would be untranslatable at
 * exactly the point a reader most needs to understand it. `diagnostics` takes
 * a replacement map, the same way counts take their empty word and a divider
 * takes its text.
 */
export type SeverityNames = Readonly<Record<number, string>>;

export const severityNames: SeverityNames = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};
