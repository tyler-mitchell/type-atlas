import { createTypeAtlas, renderDocument, type VolarWorkspacePool } from "@type-atlas/core";
import { positionText, type Row, displayPath } from "@type-atlas/atlascii";

/**
 * What marks a declaration the walk stopped at.
 *
 * Not a figure: the glyph set holds every name to one width so alignment
 * computed against one set holds for the other, and no ASCII ellipsis is one
 * column wide. `truncate` takes its ellipsis as an argument for the same
 * reason.
 */
const frontierMark = "…";
import type { DocumentSymbol, Location, Position, Range } from "vscode-languageserver-protocol";

type Node = {
  readonly name: string;
  readonly uri: string;
  readonly selection: Range;
  readonly depth: number;
  /** The declaration this one was reached from. Absent on the seed. */
  readonly from?: string;
};

type Site = {
  /** The declaration holding this site, by identity — names collide. */
  readonly owner: string;
  readonly uri: string;
  readonly range: Range;
  readonly text: string;
  readonly within: string;
};

const contains = (range: Range, position: Position) =>
  (range.start.line < position.line ||
    (range.start.line === position.line && range.start.character <= position.character)) &&
  (position.line < range.end.line ||
    (position.line === range.end.line && position.character <= range.end.character));

const innermost = (
  symbols: readonly DocumentSymbol[],
  position: Position,
): DocumentSymbol | undefined => {
  const branch = symbols.find((symbol) => contains(symbol.range, position));
  if (!branch) return undefined;
  return innermost(branch.children ?? [], position) ?? branch;
};

const key = (uri: string, selection: Range) =>
  `${uri}:${selection.start.line}:${selection.start.character}`;

export const createQuorl =
  (dependencies: { readonly workspaces: VolarWorkspacePool }) =>
  async (request: {
    readonly workspace: string;
    readonly file: string;
    readonly position: Position;
    readonly depth: number;
    readonly limit: number;
    readonly signal: AbortSignal;
  }): Promise<string> => {
    const workspace = await dependencies.workspaces.get(request.workspace);
    const intelligence = createTypeAtlas(workspace);
    const outlines = new Map<string, readonly DocumentSymbol[]>();
    const lines = new Map<string, readonly string[]>();

    const outlineOf = async (uri: string) => {
      const held = outlines.get(uri);
      if (held) return held;
      const read = await workspace.readTextDocumentUri(uri, request.signal);
      const { result } = await intelligence.documentSymbols({
        file: displayPath(uri, request.workspace),
        signal: request.signal,
      });
      const symbols = (result ?? []) as readonly DocumentSymbol[];
      outlines.set(uri, symbols);
      lines.set(uri, read.source.split("\n"));
      return symbols;
    };

    const seedOutline = await outlineOf(workspace.getWorkspaceUri(request.file));
    const seedSymbol = innermost(seedOutline, request.position);
    const visited = new Map<string, Node>();
    const sites: Site[] = [];
    const unexpanded: Node[] = [];

    const seed: Node = {
      name: seedSymbol?.name ?? "the position",
      uri: workspace.getWorkspaceUri(request.file),
      selection: seedSymbol?.selectionRange ?? { start: request.position, end: request.position },
      depth: 0,
    };
    const queue: Node[] = [seed];
    visited.set(key(seed.uri, seed.selection), seed);

    while (queue.length) {
      const node = queue.shift()!;
      if (visited.size > request.limit) {
        unexpanded.push(node);
        continue;
      }
      const { result } = await intelligence.references({
        file: displayPath(node.uri, request.workspace),
        signal: request.signal,
        params: {
          position: node.selection.start,
          context: { includeDeclaration: false },
          scope: "workspace",
        },
      });
      for (const location of (result ?? []) as readonly Location[]) {
        const outline = await outlineOf(location.uri);
        const enclosing = innermost(outline, location.range.start);
        const source = lines.get(location.uri)?.[location.range.start.line] ?? "";
        sites.push({
          owner: enclosing ? key(location.uri, enclosing.selectionRange) : "",
          uri: location.uri,
          range: location.range,
          text: source.trim(),
          within: enclosing?.name ?? "top level",
        });
        if (!enclosing) continue;
        const next: Node = {
          name: enclosing.name,
          uri: location.uri,
          selection: enclosing.selectionRange,
          depth: node.depth + 1,
          from: key(node.uri, node.selection),
        };
        const id = key(next.uri, next.selection);
        if (visited.has(id)) continue;
        visited.set(id, next);
        if (next.depth >= request.depth) {
          unexpanded.push(next);
          continue;
        }
        queue.push(next);
      }
    }

    // A closure is a tree: every declaration but the seed was reached from
    // another one. Grouping by file discards that, and the question a caller
    // asked — what reaches this, and through what — is answered by the shape.
    const children = new Map<string, Node[]>();
    for (const node of visited.values()) {
      if (node.from === undefined) continue;
      children.set(node.from, [...(children.get(node.from) ?? []), node]);
    }
    const frontier = new Set(unexpanded.map((node) => key(node.uri, node.selection)));
    // A declaration's own line matches a search for it; listing it under itself
    // says nothing about what reaches it.
    const sitesWithin = (node: Node) =>
      sites.filter(
        (site) =>
          site.owner === key(node.uri, node.selection) &&
          // Both coordinates: a declaration and a reference to something else
          // share a line all the time — `const rendered = await renderDocument(`.
          !(
            site.range.start.line === node.selection.start.line &&
            site.range.start.character === node.selection.start.character
          ),
      );
    const branch = (node: Node, underFile = false): Row => {
      const id = key(node.uri, node.selection);
      return {
        name: node.name,
        fields: [
          // Same file as the parent: the position stands alone, the way
          // every grouped location on this surface reads — `:12:52` kept a
          // colon whose path the row above had already said.
          underFile
            ? positionText(node.selection.start)
            : `${displayPath(node.uri, request.workspace)}:${positionText(node.selection.start)}`,
          frontier.has(id) ? frontierMark : undefined,
        ],
        children: [
          ...sitesWithin(node).map((site) => ({
            name: positionText(site.range.start),
            fields: [site.text],
          })),
          ...folded(children.get(id) ?? []),
        ],
      };
    };
    // Structure owns the nesting; file grouping is run-length collapse only:
    // consecutive siblings sharing a file fold under one file line, in
    // structure order, never re-sorted — seven kek test-file siblings each
    // spent ~50 characters restating one path. A run of one keeps its path
    // on the line, because a header over a single row costs more than it
    // saves.
    const folded = (nodes: readonly Node[]): Row[] =>
      nodes
        .reduce<Node[][]>((held, node) => {
          const run = held[held.length - 1];
          return run && run[0]!.uri === node.uri
            ? [...held.slice(0, -1), [...run, node]]
            : [...held, [node]];
        }, [])
        .map((run) =>
          run.length === 1
            ? branch(run[0]!)
            : {
                name: displayPath(run[0]!.uri, request.workspace),
                children: run.map((node) => branch(node, true)),
              },
        );

    const rendered = await renderDocument({
      document: "quorl.tool.mdoc",
      variables: {
        name: seed.name,
        declarations: visited.size,
        sites: sites.length,
        depth: request.depth,
        entries: [branch(seed)],
        unexpanded: unexpanded.length,
      },
    });
    return rendered.text;
  };
