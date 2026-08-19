/**
 * Structural primitives: grouping, nesting, walking.
 *
 * No Markdoc, no formatting, no domain. Several components need the same
 * shapes — collect rows under a key, rebuild nesting from a flat list, flatten
 * a tree while tracking depth — and each had written its own copy inline.
 */

/**
 * Collects values under a key, keeping first-seen order.
 *
 * Order matters here in a way it does not for a plain map: a report lists files
 * in the order the language server reported them, and re-sorting would silently
 * change what a reader sees first.
 */
export const groupBy = <Value, Key>(input: {
  readonly values: readonly Value[];
  readonly by: (value: Value) => Key;
}): ReadonlyMap<Key, readonly Value[]> =>
  input.values.reduce((groups, value) => {
    const key = input.by(value);
    return groups.set(key, [...(groups.get(key) ?? []), value]);
  }, new Map<Key, readonly Value[]>());

export type Nested<Entry> = {
  readonly entry: Entry;
  readonly children: readonly Nested<Entry>[];
};

/**
 * Rebuilds a tree from a flat list whose entries carry their own depth.
 *
 * Language servers report an outline this way — a sequence where each entry
 * says how deep it sits — and a renderer that wants to draw connectors needs
 * the nesting back. An entry belongs to the last entry shallower than it, so a
 * run of deeper entries after one is exactly its subtree.
 */
export const nestByDepth = <Entry>(input: {
  readonly entries: readonly Entry[];
  readonly depthOf: (entry: Entry) => number;
  readonly level?: number;
}): readonly Nested<Entry>[] => {
  const level = input.level ?? 0;
  return input.entries.flatMap((entry, index) => {
    if (input.depthOf(entry) !== level) return [];
    const after = input.entries.slice(index + 1);
    const ends = after.findIndex((next) => input.depthOf(next) <= level);
    return [
      {
        entry,
        children: nestByDepth({
          entries: ends < 0 ? after : after.slice(0, ends),
          depthOf: input.depthOf,
          level: level + 1,
        }),
      },
    ];
  });
};

/**
 * Walks a tree depth-first, handing each node its depth.
 *
 * Depth is a property of position, so a caller passes the tree it has and never
 * computes a level itself. The visitor returns whatever a component needs, and
 * the results arrive in reading order.
 */
export const walk = <Node, Result>(input: {
  readonly nodes: readonly Node[];
  readonly childrenOf: (node: Node) => readonly Node[] | undefined;
  readonly visit: (node: Node, depth: number) => Result;
  readonly depth?: number;
}): Result[] => {
  const depth = input.depth ?? 0;
  return input.nodes.flatMap((node) => [
    input.visit(node, depth),
    ...walk({ ...input, nodes: input.childrenOf(node) ?? [], depth: depth + 1 }),
  ]);
};
