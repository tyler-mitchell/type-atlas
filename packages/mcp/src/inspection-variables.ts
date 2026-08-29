import type { CallSite, InspectSymbolResult, Located } from "@type-atlas/core";
import { type LocationNode, rangeText, sameRange, displayPath, slash } from "@type-atlas/atlascii";
import { isFileInDir } from "@volar/language-server/node.js";
import { type CallHierarchyItem, type Range, SymbolKind } from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";

/**
 * Reading order, the same as every other located answer.
 *
 * Left unsorted, these arrive in whatever order the reference search produced:
 * one import statement reported its imported name and its local alias as `4:28`
 * above `4:10`, which reads as two unrelated places rather than two columns of
 * one line.
 */
const byPosition = (left: Located, right: Located) =>
  left.selectionRange.start.line - right.selectionRange.start.line ||
  left.selectionRange.start.character - right.selectionRange.start.character;

const byFile = <Item>(items: readonly Item[], uriOf: (item: Item) => string) => [
  ...Map.groupBy(items, uriOf),
];

/**
 * Locations under the file holding them — as a level, or on the line.
 *
 * The path is a level when that saves repetition, and costs two lines and a
 * connector when it does not. So the shape follows the data: grouped when some
 * file holds more than one, flat when none does. The document renders whichever
 * arrives without knowing which it was, because both are the same node.
 */
const located = (
  items: readonly Located[],
  root: string,
  facts: (item: Located) => LocationNode,
): readonly LocationNode[] => {
  const groups = byFile(items, ({ uri }) => uri);
  return groups.some(([, held]) => held.length > 1)
    ? groups.map(([uri, grouped]) => ({
        file: displayPath(uri, root),
        children: [...grouped].sort(byPosition).map(facts),
      }))
    : groups.flatMap(([uri, grouped]) =>
        grouped.map((item) => ({ file: displayPath(uri, root), ...facts(item) })),
      );
};

const locationGroups = (items: readonly Located[], root: string) =>
  located(items, root, (item) => ({
    selection: item.selectionRange,
    extent: sameRange(item.range, item.selectionRange) ? undefined : item.range,
    name: item.name,
    text: item.sourceLine?.trim() || undefined,
  }));

/**
 * Candidates carry what tells them apart.
 *
 * A choice between six same-named declarations is decided by kind, by what
 * encloses each one, and by its signature — the three facts a plain location
 * row leaves out.
 */
const candidateGroups = (items: readonly Located[], root: string) =>
  located(items, root, (item) => ({
    selection: item.selectionRange,
    extent: sameRange(item.range, item.selectionRange) ? undefined : item.range,
    name: item.name,
    kind: item.kind,
    within: item.within,
    detail: item.detail,
    text: item.sourceLine?.trim() || undefined,
  }));

const callGroups = (calls: readonly CallSite[], root: string, sharedSiteUri?: string) => {
  const groups = byFile(calls, (call) => call.item.uri);
  // The same judgement every other located answer makes: a file heading one
  // callable spends two lines and a connector saying what fits on one.
  const facts = ({ item, siteUri, sites }: CallSite) => ({
    name: item.name,
    kind: item.kind,
    selection: item.selectionRange,
    extent:
      item.kind === SymbolKind.Module || sameRange(item.range, item.selectionRange)
        ? undefined
        : item.range,
    // The language server returns sites in whatever order its search
    // produced, which came out descending — `calls 99:16, 98:16, 97:16` —
    // and every other located answer here reads down the file.
    // One position per site, in reading order. A call hierarchy reports the
    // same range once per overload it resolved through, and returns them in
    // whatever order its search produced — which came out descending.
    sites: [
      ...new Set(
        [...sites]
          .sort(
            (left, right) =>
              left.start.line - right.start.line || left.start.character - right.start.character,
          )
          .map((site) => rangeText(site)),
      ),
    ],
    siteFile:
      siteUri === sharedSiteUri || siteUri === item.uri ? undefined : displayPath(siteUri, root),
    detail: item.detail && item.kind !== SymbolKind.Module ? item.detail : undefined,
  });
  const inReadingOrder = (held: readonly CallSite[]) =>
    [...held].sort((left, right) => byPosition(left.item, right.item));
  return groups.some(([, held]) => held.length > 1)
    ? groups.map(([uri, grouped]) => ({
        file: displayPath(uri, root),
        children: inReadingOrder(grouped).map(facts),
      }))
    : groups.flatMap(([uri, grouped]) =>
        grouped.map((call) => ({ file: displayPath(uri, root), ...facts(call) })),
      );
};

/**
 * Shapes one call-hierarchy direction into the variables both call documents read.
 *
 * The two directions carry the same parts — a prepared callable, and calls that
 * each name another callable with the ranges where the relationship shows — and
 * differ only in which side of a call that other callable sits on.
 *
 * It lives here rather than beside the tools that register those documents
 * because a third caller wanted it: a composition asks for the same two
 * directions, and shaping them a second way would have answered the same
 * question in a different voice.
 */
export const callHierarchyVariables = <
  Call extends { readonly fromRanges: readonly Range[] },
>(input: {
  readonly items: readonly CallHierarchyItem[] | null;
  readonly calls: readonly (readonly Call[] | null)[] | null;
  readonly root: string;
  readonly callable: (call: Call) => CallHierarchyItem;
}) => {
  const subject = input.items?.[0];
  const flat = (input.calls ?? []).flatMap((group) => group ?? []);
  // The default TypeScript libraries are real callables and pure noise: they
  // outnumber a function's own calls, repeat once per overload declaration,
  // and their paths name whatever directory the compiler is installed under —
  // which differs between this repository and a consumer install. They fold
  // to one line of distinct names, so the answer stays about the project.
  const standardLibrary = (call: Call) =>
    /\/lib\/lib\.[^/]+\.d\.ts$/u.test(input.callable(call).uri);
  const libraryCalls = flat.filter(standardLibrary);
  const grouped = flat
    .filter((call) => !standardLibrary(call))
    .reduce((files, call) => {
      const file = displayPath(input.callable(call).uri, input.root);
      return files.set(file, [...(files.get(file) ?? []), call]);
    }, new Map<string, Call[]>());
  return {
    name: subject?.name,
    total: flat.length,
    standardLibrary:
      libraryCalls.length > 0
        ? {
            count: libraryCalls.length,
            names: [...new Set(libraryCalls.map((call) => input.callable(call).name))]
              .sort()
              .join(", "),
          }
        : undefined,
    origin: subject
      ? [
          {
            file: displayPath(subject.uri, input.root),
            selection: subject.selectionRange,
            range: subject.range,
          },
        ]
      : [],
    groups: [...grouped].map(([file, entries]) => ({
      file,
      children: entries.map((call) => {
        const callable = input.callable(call);
        return {
          name: callable.name,
          kind: callable.kind,
          selection: callable.selectionRange,
          extent: sameRange(callable.range, callable.selectionRange) ? undefined : callable.range,
          // One position per site: a call hierarchy reports the same range once
          // per overload it resolved through.
          sites: [...new Set(call.fromRanges.map((site) => rangeText(site)))],
        };
      }),
    })),
  };
};

/** Outside the workspace, or inside its dependencies, is not the reader's code. */
export const isDependency = (uri: string, root: string) => {
  const parsed = URI.parse(uri);
  return !isFileInDir(slash(parsed.fsPath), slash(root)) || parsed.path.includes("/node_modules/");
};

/**
 * One side of a call hierarchy, split into the code a reader owns and the code
 * they only call into.
 *
 * Dependency calls are named without locations: `map`, `reduce`, `split` says
 * everything a reader needs, where forty rows pointing into `lib.es5.d.ts` bury
 * the handful of calls they could act on.
 */
const relatedCalls = (input: {
  readonly calls: readonly CallSite[];
  readonly root: string;
  readonly limit: number;
  readonly detailedDependencies: boolean;
  readonly sharedSiteUri?: string;
}) => {
  const dependencies = input.detailedDependencies
    ? []
    : input.calls.filter((call) => isDependency(call.item.uri, input.root));
  const owned = input.detailedDependencies
    ? input.calls
    : input.calls.filter((call) => !isDependency(call.item.uri, input.root));
  const shown = owned.slice(0, input.limit);
  const names = [...new Set(dependencies.map(({ item }) => item.name))];
  return {
    groups: callGroups(shown, input.root, input.sharedSiteUri),
    shown: shown.length,
    total: owned.length,
    dependencies: names.slice(0, input.limit),
    dependencyTotal: names.length,
    sharedSite:
      input.sharedSiteUri === undefined ? undefined : displayPath(input.sharedSiteUri, input.root),
  };
};

const counted = <Item>(items: readonly Item[], groups: readonly LocationNode[]) => ({
  groups,
  shown: items.length,
  total: items.length,
});

/**
 * An inspection as the values its document renders from.
 *
 * Nothing here decides how the answer reads: grouping, ordering, and the
 * workspace/dependency split are selection, and the words belong to the
 * document.
 */
export const inspectionVariables = (input: {
  readonly result: InspectSymbolResult;
  readonly root: string;
}) => {
  const { result, root } = input;
  if (result.choice) {
    return {
      choice: {
        reason: result.choice.reason,
        name: result.choice.name,
        file: displayPath(result.textDocument.uri, root),
        candidates: candidateGroups(result.choice.candidates, root),
        shown: result.choice.candidates.length,
        total: result.choice.total,
      },
    };
  }
  const primary = result.primary;
  if (!primary) return {};
  const additionalDefinitions = result.additionalDefinitions ?? [];
  // Nothing implements a type alias — `implements` cannot name one — so the
  // walk's answer for an alias is whatever variable happens to be annotated
  // with it, which is noise. It is also not the same noise everywhere: a
  // packed build on Linux listed a `readonly Money[]` constant under `Money`
  // where the same question answered nothing on macOS, and the release gate
  // failed on that difference (docs/issues.md).
  const aliasSubject = /^```\w*\s*type\s/u.test(result.hover ?? "");
  const implementations = aliasSubject ? [] : (result.implementations ?? []);
  const typeDefinitions = result.typeDefinitions ?? [];
  const callers = result.callers ?? [];
  const callees = result.callees ?? [];
  const mentions = result.references?.shown ?? [];
  const limit = result.limit ?? mentions.length;
  return {
    symbol: {
      name: result.name,
      kind: primary.kind,
      file: displayPath(primary.uri, root),
      selection: primary.selectionRange,
      // Named only when it differs from the selection: restating an
      // identifier's own span costs a second read to learn nothing.
      extent: sameRange(primary.range, primary.selectionRange) ? undefined : primary.range,
      // The same path style every sibling anchor wears. At the workspace root
      // this reads as the bare `tsconfig.json`, which the other tools already
      // accept — one absolute path here was the surface's only style break.
      project: result.project ? displayPath(result.project, root) : undefined,
    },
    documentation: result.hover,
    additionalDefinitions: counted(
      additionalDefinitions,
      locationGroups(additionalDefinitions, root),
    ),
    implementations: counted(implementations, locationGroups(implementations, root)),
    // An interface with no implementations section reads as "realised
    // nowhere", and on this platform the implementation walk answers only
    // from files the session has opened — a kek interface with realisers in
    // untouched files misled exactly that way. Only for kinds a reader
    // expects the section on; a variable's absent section claims nothing —
    // and neither does an alias's, which is why the apology skips those too.
    unansweredImplementations:
      primary.kind === SymbolKind.Interface && implementations.length === 0 && !aliasSubject,
    typeDefinitions: counted(typeDefinitions, locationGroups(typeDefinitions, root)),
    callers:
      callers.length > 0
        ? relatedCalls({ calls: callers, root, limit, detailedDependencies: true })
        : undefined,
    callees:
      callees.length > 0
        ? relatedCalls({
            calls: callees,
            root,
            limit,
            detailedDependencies: result.compactExternalCalls === false,
            sharedSiteUri: result.sharedCalleeUri,
          })
        : undefined,
    mentions: {
      groups: locationGroups(mentions, root),
      // How many of the non-call uses are here, against how many there are —
      // separately from the reference total, which counts calls too.
      listed: { shown: mentions.length, total: result.references?.other ?? 0 },
      total: result.references?.total ?? 0,
      // The reach behind the counts, as every fan-out answer states it.
      projects: result.references?.projects ?? 0,
    },
    source:
      result.source === undefined
        ? undefined
        : {
            file: displayPath(primary.uri, root),
            range: primary.range,
            lines: result.source.lines,
            startLine: result.source.startLine,
          },
  };
};
