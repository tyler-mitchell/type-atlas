import Markdoc, { type Config } from "@markdoc/markdoc";

// Markdoc ships CommonJS; its values live on the default export, so naming
// `Tag` in the import list would throw under Node even though it type-checks.
const { Tag } = Markdoc;
import { type ChangeGroup, type DiffChunk, type StackFrame } from "../protocol/shapes.ts";
import { blocks, paragraph, stack } from "./nodes.ts";
import { render } from "./render.ts";
import { defaultMarks } from "../config/marks.ts";
import { resolve } from "../config/index.ts";
import { guideNames } from "../config/guides.ts";
import { diff } from "../components/diff.ts";
import { type Row, rowBranches } from "../layout/rows.ts";
import { changes } from "../components/changes.ts";
import { type FoldingRange, foldedSource } from "../source/folded.ts";
import { frames } from "../components/location-links.ts";
import { codeFrame } from "../source/frame.ts";
import { divider } from "../layout/divider.ts";
import { diagnosticSeverity } from "../protocol/kinds.ts";
import { label } from "../layout/label.ts";
import { breakdown } from "../text/time.ts";
import { counts } from "../components/counts.ts";
import { summaryRow } from "../layout/summary.ts";
import { indented } from "../layout/indent.ts";
import { tableRows } from "../layout/table.ts";
import { type Branch, hierarchy } from "../layout/hierarchy.ts";
import { plural } from "../text/plural.ts";
import { formatTime } from "../text/time.ts";
import { padEnd, padStart, truncate } from "../text/width.ts";

/**
 * Components, as Markdoc tags emitting Markdoc's own nodes.
 *
 * The contract is Markdoc's, unchanged: named typed attributes are the props,
 * `transformChildren` gives the children, and the return is a `Tag`. What the
 * tags return is Markdoc's existing vocabulary — `p` for a block, `br` for a
 * line break, `h2` for a heading — so nothing here invents a layout language.
 * `render.ts` implements that vocabulary as text.
 *
 * Data-driven components take their data in a named attribute, because two
 * hundred references cannot be hand-authored as children. The contract is the
 * same either way.
 */
/**
 * Entries drawn to a depth, their lines composed wherever the document says.
 *
 * With a `partial`, each entry's own line is markup — resolved and transformed
 * against that entry, which is the only way to bind a name per item in an
 * engine that resolves once up front. Without one, the entry's fields are
 * joined by the configured marks. Either way the guide draws the depth, which
 * is the part markup cannot express: leading whitespace does not survive
 * Markdown, and a connector depends on siblings a document cannot see.
 */
const nested = (
  node: Parameters<NonNullable<Config["tags"]>[string]["transform"] & object>[0],
  config: Parameters<NonNullable<Config["tags"]>[string]["transform"] & object>[1],
  guide: Parameters<typeof hierarchy>[0]["guide"],
) => {
  const entries = (node.attributes.entries as Row[] | undefined) ?? [];
  if (entries.length === 0) return "";
  const source =
    node.attributes.partial === undefined
      ? undefined
      : config.partials?.[node.attributes.partial as string];
  const name = (node.attributes.as as string | undefined) ?? "node";
  const composed = (item: Record<string, unknown>): Branch => {
    const scoped = { ...config, variables: { ...config.variables, [name]: item } };
    return {
      label: render(blocks([source!.resolve(scoped).transform(scoped)].flat())),
      children: ((item.children as Record<string, unknown>[] | undefined) ?? []).map(composed),
    };
  };
  return stack(
    hierarchy({
      branches: source
        ? (entries as unknown as Record<string, unknown>[]).map(composed)
        : rowBranches(entries, node.attributes.config),
      guide,
    }),
  );
};

export const tags: Config["tags"] = {
  /**
   * A declaration of code intelligence a composed document wants — not a
   * component, and it renders nothing. The composer names an operation and
   * the variable to bind its answer to; whoever renders the document
   * fulfills every ask before rendering, so the body composes the answers
   * with the same tags and partials every authored document uses. Which
   * operations exist, and the shape each binds, belongs to the fulfiller.
   */
  ask: {
    selfClosing: true,
    attributes: {
      primary: { type: String, required: true },
      as: { type: String, required: true },
      file: { type: String },
      /** Files from an earlier ask's answer: `files=$uses.paths`. */
      files: { type: Array },
      line: { type: Number },
      character: { type: Number },
      /** A declaration by name, for an ask that would otherwise need a position. */
      symbol: { type: String },
      /** Keeps an outline's full hierarchy instead of folding value insides. */
      raw: { type: Boolean },
      /** How many levels of nested declarations an outline opens. */
      depth: { type: Number },
      /** Narrows located results to or away from test files: "only", "exclude". */
      tests: { type: String },
      /** Where a search looks, and how much it returns. */
      directory: { type: String },
      limit: { type: Number },
      snippetLines: { type: Number },
      query: { type: String },
      /** Exact text for a literal ask, as distinct from a query by meaning. */
      text: { type: String },
      from: { type: Number },
      to: { type: Number },
    },
    transform: () => "",
  },

  /** A titled section: a heading and whatever a document puts under it. */
  section: {
    attributes: { title: { type: String, required: true }, level: { type: Number } },
    transform: (node, config) =>
      new Tag("article", {}, [
        new Tag(`h${node.attributes.level ?? 2}`, {}, [node.attributes.title]),
        ...node.transformChildren(config),
      ] as never[]),
  },

  /**
   * Titled blocks, one after another.
   *
   * A document names a tag but cannot repeat one — the engine resolves every
   * variable before a tag transforms, so nothing can bind a name per item. A
   * sequence of sections is therefore passed as data and titled here, using
   * heading nodes rather than written hashes so the renderer still decides what
   * a heading looks like.
   */
  sections: {
    selfClosing: true,
    attributes: { items: { type: Array, required: true }, level: { type: Number } },
    transform: (node) => {
      const items =
        (node.attributes.items as
          | readonly { readonly title?: string; readonly text: string }[]
          | undefined) ?? [];
      return blocks(
        items.flatMap((item) => [
          ...(item.title === undefined
            ? []
            : // Two, because a section is a named part *within* one subject and
              // that is what every other section in this surface is. Defaulting
              // to three made the one tool that passes no level title its parts
              // a level deeper than its neighbours, for no reason a reader could
              // see.
              [new Tag(`h${node.attributes.level ?? 2}`, {}, [item.title] as never[])]),
          stack(item.text.split("\n")),
        ]),
      );
    },
  },

  /**
   * The document's own loop: a partial, once per item.
   *
   * The body lives in a partial rather than in children because the engine
   * resolves the whole tree against one set of variables before any tag
   * transforms — inline children arrive already flattened, with nothing left to
   * bind. A partial is held as raw source, so it can be transformed again per
   * item with that item bound to a name, which is what lets a document decide
   * the shape of a repeated block instead of handing that decision to a
   * component built for one collection.
   */
  each: {
    selfClosing: true,
    attributes: {
      items: { type: Array, required: true },
      as: { type: String, required: true },
      partial: { type: String, required: true },
      tight: { type: Boolean },
    },
    transform: (node, config) => {
      const items = (node.attributes.items as unknown[] | undefined) ?? [];
      // Nothing to repeat means nothing to look up. A document naming a
      // collection nobody passed says nothing about it, and demanding the
      // partial first would turn that silence into a crash.
      if (items.length === 0) return "";
      const name = node.attributes.as as string;
      const source = config.partials?.[node.attributes.partial as string];
      if (!source) {
        throw new Error(`No partial named ${node.attributes.partial} was given to this render.`);
      }
      const rendered = items.flatMap((item) => {
        // Resolve then transform, in that order and per item: the engine
        // resolves a tree once up front and `transform` assumes that already
        // happened, so a partial handed straight to `transform` renders its
        // variables as nothing.
        const scoped = { ...config, variables: { ...config.variables, [name]: item } };
        const output = source.resolve(scoped).transform(scoped);
        return Array.isArray(output) ? output : [output];
      });
      return node.attributes.tight ? stack(rendered) : blocks(rendered);
    },
  },

  /**
   * Children run together, with no blank line between them.
   *
   * Markdown separates blocks, which is right for prose and wrong for a heading
   * and the rows belonging to it. A document says which of the two it means
   * rather than accepting one everywhere.
   */
  tight: {
    transform: (node, config) => stack(node.transformChildren(config)),
  },

  /**
   * Children shifted right, so a document can say what sits under what.
   *
   * Markdown owns leading whitespace — written into a document it means code
   * block, or it means nothing — so depth cannot be expressed by typing spaces.
   * Expressed as a tag it can: the shift is applied to the rendered lines,
   * after markup has had its say about them.
   */
  indent: {
    attributes: { by: { type: Number }, unit: { type: String } },
    transform: (node, config) => {
      const text = render(blocks(node.transformChildren(config)));
      return text === ""
        ? ""
        : stack(
            indented({
              value: text,
              level: node.attributes.by ?? 1,
              unit: node.attributes.unit ?? defaultMarks.indent,
            }).split("\n"),
          );
    },
  },

  /**
   * A value held to a column, so what follows it lines up down the page.
   *
   * Measurement, not composition: `483:8` and `187:27` differ in width, and a
   * document has no way to know which is wider. It says which column it wants
   * and by how the value is measured — display width, so a wide glyph counts
   * for the two columns it occupies.
   */
  pad: {
    selfClosing: true,
    attributes: {
      value: { type: String, required: true },
      columns: { type: Number, required: true },
      end: { type: Boolean },
    },
    transform: (node) =>
      (node.attributes.end === false ? padStart : padEnd)({
        value: node.attributes.value,
        columns: node.attributes.columns,
      }),
  },

  /**
   * What a protocol severity is called.
   *
   * A tag rather than a function because absence carries meaning here: a
   * problem that arrived without a severity is named, not skipped, and a
   * function returns the empty string for an argument it never received. The
   * word itself comes from the catalog, so a consumer renaming it renames it
   * everywhere.
   */
  severity: {
    selfClosing: true,
    attributes: { value: { type: Number }, config: { type: Object } },
    transform: (node) =>
      diagnosticSeverity(node.attributes.value as number | undefined, node.attributes.config),
  },

  /**
   * A banner: what everything under it belongs to, until the next one.
   *
   * A heading says a section starts here; a banner says everything below is
   * this until the next banner. A file's contents, a package's surface, and a
   * symbol's report are all the second kind, and a reader scanning several
   * needs to see where one ends without counting blank lines.
   *
   * It takes its name as children rather than as an attribute because that
   * name is composed — a path, a count, a windowed range, each under its own
   * condition — and a string attribute could hold none of it. What encloses it
   * is a mark, so a consumer that cannot render `===` changes one setting and
   * every banner in every document follows.
   */
  banner: {
    attributes: { config: { type: Object } },
    transform: (node, config) => {
      const { marks } = resolve(node.attributes.config);
      // A paragraph, not blocks: the name is one line assembled from pieces,
      // and blocks would set a blank line between every piece of it.
      const named = render(paragraph(node.transformChildren(config)));
      return paragraph([`${marks.bannerOpen}${named}${marks.bannerClose}`]);
    },
  },

  /** A rule, optionally naming what it opens. */
  divider: {
    selfClosing: true,
    attributes: { text: { type: String }, right: { type: Number }, width: { type: Number } },
    transform: (node) => paragraph([divider(node.attributes)]),
  },

  /** Rows of labelled values, aligned. Children are `row` tags. */
  summary: {
    transform: (node, config) => stack(node.transformChildren(config)),
  },
  row: {
    selfClosing: true,
    attributes: {
      label: { type: String, required: true },
      value: { type: String, required: true },
    },
    transform: (node) => summaryRow(node.attributes as never),
  },

  /** Reported problems: severity first, location last, message beneath. */
  /**
   * Source around a position, with carets under the span it names.
   *
   * Emits its lines stacked rather than one joined string, so a document can
   * nest it under a heading or beside a diagnostic and the renderer still owns
   * the spacing.
   */
  frame: {
    selfClosing: true,
    attributes: {
      source: { type: String, required: true },
      line: { type: Number, required: true },
      character: { type: Number, required: true },
      endLine: { type: Number },
      endCharacter: { type: Number },
      context: { type: Number },
    },
    transform: (node) => {
      const { source, line, character, endLine, endCharacter, context } = node.attributes;
      const rendered = codeFrame({
        source,
        line,
        character,
        end: endLine === undefined ? undefined : { line: endLine, character: endCharacter ?? 1 },
        range: context,
      });
      return rendered === "" ? "" : stack(rendered.split("\n"));
    },
  },

  /**
   * A difference between two versions, as unified lines.
   *
   * Takes chunks that are already computed. Which diff algorithm produced them
   * is not a formatting question, and a library that renders text should not
   * carry a Myers implementation to answer one — Vitest reaches for
   * `diff-sequences` here, and a consumer can reach for whatever it already has.
   *
   * The markers and annotations are Vitest's documented defaults, all of them
   * overridable, because `-`/`+` are conventions and `Expected`/`Received` are
   * words:
   *
   *     - Expected
   *     + Received
   *
   *     - true
   *     + false
   */
  diff: {
    selfClosing: true,
    attributes: {
      chunks: { type: Array, required: true },
      context: { type: Number },
      config: { type: Object },
    },
    transform: (node) => {
      const parts = diff({
        chunks: node.attributes.chunks as DiffChunk[],
        context: node.attributes.context as number | undefined,
        config: node.attributes.config,
      });
      return parts.length === 0 ? "" : blocks(parts.map(stack));
    },
  },

  /** A table whose columns are as wide as their widest cell. */
  table: {
    selfClosing: true,
    attributes: {
      rows: { type: Array, required: true },
      columns: { type: Array, required: true },
      gap: { type: Number },
    },
    transform: (node) => {
      const lines = tableRows({
        rows: node.attributes.rows,
        columns: node.attributes.columns,
        gap: node.attributes.gap,
      });
      return lines.length === 0 ? "" : stack(lines);
    },
  },

  /**
   * Files grouped by what happened to them, each with its own keys beneath.
   *
   * Generalised from Vitest's `renderSnapshotSummary`, including its two
   * markers: `↳` leads a file, `·` leads a key within one, so depth is legible
   * without indentation alone carrying it.
   */
  changes: {
    selfClosing: true,
    attributes: { groups: { type: Array, required: true } },
    transform: (node) => {
      const written = changes({
        groups: node.attributes.groups as ChangeGroup[],
        config: node.attributes.config,
      });
      return written.length === 0 ? "" : blocks(written.map(stack));
    },
  },

  /**
   * Values that need more than one input, so they are tags rather than
   * functions: a named attribute says what each one is, where a positional
   * argument would leave the reader counting commas.
   */
  /**
   * The form a count takes, by the plural rules of a locale.
   *
   * Replaces a singular/plural pair, which is an English assumption: CLDR
   * defines six categories and languages use different subsets. `other` is the
   * one every language has, so a two-form catalog stays two entries and a
   * four-form language supplies four.
   *
   * `type="ordinal"` selects `1st`/`2nd`/`3rd` by the same mechanism.
   */
  plural: {
    selfClosing: true,
    attributes: {
      count: { type: Number, required: true },
      forms: { type: Object, required: true },
      locale: { type: String },
      type: { type: String, matches: ["cardinal", "ordinal"] },
    },
    transform: (node) =>
      plural({
        count: node.attributes.count,
        forms: node.attributes.forms,
        locale: node.attributes.locale,
        type: node.attributes.type,
      }),
  },

  label: {
    selfClosing: true,
    attributes: { name: { type: String, required: true }, message: { type: String } },
    transform: (node) => label({ name: node.attributes.name, message: node.attributes.message }),
  },

  truncate: {
    selfClosing: true,
    attributes: {
      value: { type: String, required: true },
      /** Defaults to the width a label is allowed, so a row stays one line. */
      columns: { type: Number },
      ellipsis: { type: String },
      config: { type: Object },
    },
    transform: (node) =>
      truncate({
        value: node.attributes.value,
        columns: node.attributes.columns ?? resolve(node.attributes.config).dimensions.labelColumns,
        ellipsis: node.attributes.ellipsis,
      }),
  },

  breakdown: {
    selfClosing: true,
    attributes: { parts: { type: Array, required: true } },
    transform: (node) => breakdown({ parts: node.attributes.parts, format: formatTime }),
  },

  counts: {
    selfClosing: true,
    attributes: {
      states: { type: Array, required: true },
      total: { type: Number },
      config: { type: Object },
    },
    transform: (node) =>
      counts({
        states: node.attributes.states,
        total: node.attributes.total,
        config: node.attributes.config,
      }),
  },

  /**
   * Navigation targets: definitions, type definitions, implementations.
   *
   * Leads with `❯` and the selection — the stack-frame shape a reader scans for
   * a jump target — and names the declaration's full extent only when it
   * differs from the selection.
   */
  /**
   * A call hierarchy: the file once, then each callable and where it calls.
   *
   * A callable is indented because its row leads with a name, the same shape a
   * file heading has — unlike a location row, which leads with a digit.
   */
  /** A document outline: kinds, ranges, nesting by depth. */
  /**
   * Symbol search hits.
   *
   * The container comes last: across a monorepo the same name occurs in many
   * projects, and the container is what tells two hits apart.
   */
  /**
   * Uses of a symbol, grouped by role and then by the file holding them.
   *
   * The path is a level rather than a prefix: thirteen uses in one module
   * printed the same forty characters thirteen times.
   */
  /**
   * Entries with things beneath them: call hierarchies, outlines, sites in a
   * file, a package's exports. One tag, because they are one shape.
   *
   * This used to be two — `tree` for connectors and `rows` for indentation —
   * identical but for the guide each passed. That made the style a document's
   * choice of tag name, so two documents showing the same shape disagreed by
   * accident and no consumer could change either. The style is config now, and
   * `guide` here overrides it only where the variant carries meaning rather
   * than taste.
   */
  tree: {
    selfClosing: true,
    attributes: {
      entries: { type: Array, required: true },
      /** A partial composing each node's own line, bound to `as`. */
      partial: { type: String },
      as: { type: String },
      guide: { type: String, matches: [...guideNames] },
      config: { type: Object },
    },
    transform: (node, config) =>
      nested(
        node,
        config,
        resolve(
          node.attributes.guide === undefined
            ? node.attributes.config
            : { ...node.attributes.config, guide: node.attributes.guide },
        ).guide,
      ),
  },

  /** Stack frames, innermost first. */
  frames: {
    selfClosing: true,
    attributes: { stack: { type: Array, required: true } },
    transform: (node) =>
      stack(
        frames({ stack: node.attributes.stack as StackFrame[], config: node.attributes.config }),
      ),
  },

  /**
   * Rows carrying only the facts that apply, nested by structure.
   *
   * An entry holds its own `children`, so a caller passes the tree it already
   * has — an outline, a selection chain, a call hierarchy — instead of
   * flattening it and computing a depth per row. Depth is a property of where a
   * row sits, which is exactly what the component can work out and the caller
   * should not have to.
   */
  /**
   * Source lines under their own numbers.
   *
   * `frame` points at one position; this shows a span of source as it stands,
   * which is what a declaration's body is.
   */
  source: {
    selfClosing: true,
    attributes: {
      lines: { type: Array, required: true },
      /** The number the first given line carries. A snippet cut out of a file knows this; a whole file starts at one. */
      startLine: { type: Number },
      /** The span to show, when only part of what was given should appear. */
      from: { type: Number },
      to: { type: Number },
      ranges: { type: Array },
      config: { type: Object },
    },
    transform: (node) => {
      const rendered = foldedSource({
        lines: node.attributes.lines as string[],
        ranges: (node.attributes.ranges as FoldingRange[] | undefined) ?? [],
        window: {
          sourceStartLine: node.attributes.startLine ?? 1,
          startLine: node.attributes.from,
          endLine: node.attributes.to,
        },
        config: node.attributes.config,
      });
      return rendered.text === "" ? "" : stack(rendered.text.split("\n"));
    },
  },
};
