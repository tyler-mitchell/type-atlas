import {
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  DefinitionRequest,
  GetMatchTsConfigRequest,
  HoverRequest,
  ImplementationRequest,
  type Location,
  type LocationLink,
  type Position,
  type Range,
  ReferencesRequest,
  SymbolKind,
  type DocumentSymbol,
  TypeDefinitionRequest,
} from "@volar/language-server/protocol.js";
import { isFileInDir } from "@volar/language-server/node.js";
import { WorkspaceReferencesRequest } from "@type-atlas/language-server/protocol";
import type { ReferenceScope } from "./operations.ts";
import { sourceLines, slash } from "@type-atlas/atlascii";
import { documentSymbols } from "./syntactic-features.ts";
import { URI } from "vscode-uri";
import { markupText as hoverContentsText, rangeText } from "@type-atlas/atlascii";
import type { VolarWorkspace } from "./volar-workspace.ts";

/** Selects either an exact document-symbol name or an LSP source position. */
export type InspectSymbolTarget = { readonly position: Position } | { readonly symbol: string };

/** Controls expensive source and type sections and bounds repeated relationships. */
export type InspectSymbolOptions = {
  readonly compactExternalCalls?: boolean;
  readonly scope?: ReferenceScope;
  readonly includeSource: boolean;
  readonly includeTypeDefinitions: boolean;
  readonly limit: number;
};

export type Located = {
  readonly uri: string;
  readonly range: Range;
  readonly selectionRange: Range;
  /** The declaration this one is nested in, when it is nested at all. */
  readonly within?: string;
  readonly name?: string;
  readonly kind?: number;
  readonly detail?: string;
  readonly sourceLine?: string;
};

/** A call and the exact places it happens, as the call hierarchy reports them. */
export type CallSite = {
  readonly item: Located & { readonly name: string; readonly kind: SymbolKind };
  readonly siteUri: string;
  readonly sites: readonly Range[];
};

/**
 * What the language server was asked and answered about one symbol.
 *
 * Composing the answer is the operation's product; rendering it is the
 * caller's, so a consumer that is not this MCP presents the same inspection
 * its own way. `choice` stands in for the rest when a name is ambiguous or
 * unresolved, carrying the bounded candidates instead of an answer.
 */
export type InspectSymbolResult = {
  readonly textDocument: { readonly uri: string };
  readonly position?: Position;
  readonly choice?: {
    readonly reason: "ambiguous" | "not found";
    readonly name: string;
    readonly candidates: readonly Located[];
    readonly total: number;
  };
  readonly primary?: Located;
  readonly name?: string;
  readonly project?: string | undefined;
  readonly hover?: string | undefined;
  readonly additionalDefinitions?: readonly Located[];
  readonly implementations?: readonly Located[];
  readonly typeDefinitions?: readonly Located[];
  readonly callers?: readonly CallSite[];
  readonly callees?: readonly CallSite[];
  readonly sharedCalleeUri?: string | undefined;
  readonly compactExternalCalls?: boolean;
  readonly limit?: number;
  readonly references?: {
    readonly shown: readonly Located[];
    readonly other: number;
    readonly total: number;
    /** How many projects the reference fan-out asked — the answer's reach. */
    readonly projects: number;
  };
  readonly source?: { readonly lines: readonly string[]; readonly startLine: number } | undefined;
};

const located = (symbol: DocumentSymbol, uri: string): Located => ({
  uri,
  name: symbol.name,
  kind: symbol.kind,
  range: symbol.range,
  selectionRange: symbol.selectionRange,
  ...(symbol.detail ? { detail: symbol.detail } : {}),
});

/**
 * Every declaration in an outline, outermost first.
 *
 * Yielded rather than returned as an array. An outline of a large file nests
 * deeply — an object literal of generic factories reaches a dozen levels — and
 * building the flat list by spreading each subtree's array into its parent's
 * copies the tail of the file once per level it sits under. On this repository's
 * 1,225-line resource module that cost 1.3 seconds, more than the whole
 * inspection around it; the callers below want a search or a first match, so
 * none of them need the array at all.
 */
function* declarations(
  symbols: readonly DocumentSymbol[],
  uri: string,
  within?: string,
): Generator<Located, void, undefined> {
  for (const symbol of symbols) {
    // The declaration each one sits in, carried down as the walk descends. A
    // name repeated throughout a file — twenty-nine `transform` methods in an
    // object of tags — is indistinguishable without it, and the outline knows
    // the parent here and nowhere later.
    yield { ...located(symbol, uri), ...(within ? { within } : {}) };
    yield* declarations(symbol.children ?? [], uri, symbol.name);
  }
}

/**
 * The innermost declaration containing a position.
 *
 * An outline is a tree, so the answer is one descent through the branch that
 * contains the position — not a search over every declaration in the file.
 */
const enclosing = (input: {
  readonly symbols: readonly DocumentSymbol[];
  readonly position: Position;
  readonly uri: string;
}): Located | undefined => {
  const branch = input.symbols.find(({ range }) => contains(range, input.position));
  if (!branch) return undefined;
  return (
    enclosing({ symbols: branch.children ?? [], position: input.position, uri: input.uri }) ??
    located(branch, input.uri)
  );
};

const callableKinds = new Set<number>([
  SymbolKind.Function,
  SymbolKind.Method,
  SymbolKind.Constructor,
]);

/**
 * The innermost callable containing a position, else the innermost declaration.
 *
 * A caller is a callable. The binding a call's result is assigned to is not
 * one, and naming it reports `rendered` where the caller is the function that
 * runs the call. The innermost declaration remains the right answer for naming
 * what a position sits in, so this is a second descent rather than a change to
 * that one.
 */
const enclosingCallable = (input: {
  readonly symbols: readonly DocumentSymbol[];
  readonly position: Position;
  readonly uri: string;
}): Located | undefined => {
  const branch = input.symbols.find(({ range }) => contains(range, input.position));
  if (!branch) return undefined;
  const deeper = enclosingCallable({
    symbols: branch.children ?? [],
    position: input.position,
    uri: input.uri,
  });
  if (deeper && deeper.kind !== undefined && callableKinds.has(deeper.kind)) return deeper;
  if (callableKinds.has(branch.kind)) return located(branch, input.uri);
  return deeper ?? located(branch, input.uri);
};

const contains = (range: Range, position: Position) =>
  (range.start.line < position.line ||
    (range.start.line === position.line && range.start.character <= position.character)) &&
  (position.line < range.end.line ||
    (position.line === range.end.line && position.character < range.end.character));

const navigationItems = (
  value: Location | readonly Location[] | readonly LocationLink[] | null,
): readonly (Location | LocationLink)[] =>
  !value ? [] : Array.isArray(value) ? value : [value as Location | LocationLink];

const locate = (item: Location | LocationLink): Located =>
  "targetUri" in item
    ? {
        uri: item.targetUri,
        range: item.targetRange,
        selectionRange: item.targetSelectionRange,
      }
    : { uri: item.uri, range: item.range, selectionRange: item.range };

const key = ({ uri, selectionRange }: Located) => `${uri}\0${rangeText(selectionRange)}`;

/** First occurrence of each key, in order, computing every key once. */
const unique = <Item>(items: readonly Item[], itemKey: (item: Item) => string) =>
  [...new Map(items.map((item) => [itemKey(item), item] as const).reverse()).values()].reverse();

/** Grouped by file in first-seen order, in one pass rather than a filter per uri. */
const groups = <Item extends { readonly uri: string }>(items: readonly Item[]) =>
  [...Map.groupBy(items, ({ uri }) => uri)].map(([uri, grouped]) => ({ uri, items: grouped }));

const documentLines = async (workspace: VolarWorkspace, uri: string) =>
  sourceLines((await workspace.readTextDocumentUri(uri)).source);

/**
 * A declaration's own lines, and the number the first of them carries.
 *
 * The lines are returned as they stand. Numbering them is presentation, and a
 * second copy of that numbering drifted once already — it padded nothing, so
 * `1|export` put code in column three and `10|}` put it in column four, and the
 * excerpt lost the straight left edge that makes a body readable.
 */
const excerpt = async (workspace: VolarWorkspace, target: Located) => {
  const lines = await documentLines(workspace, target.uri);
  const end = target.range.end.line + (target.range.end.character > 0 ? 1 : 0);
  const start = target.range.start.line;
  return { lines: lines.slice(start, end), startLine: start + 1 };
};

const withSourceLines = async (workspace: VolarWorkspace, items: readonly Located[]) =>
  (
    await Promise.all(
      groups(items).map(async ({ uri, items: related }) => {
        const lines = await documentLines(workspace, uri);
        return related.map((item) => ({
          ...item,
          sourceLine: lines[item.selectionRange.start.line] ?? "",
        }));
      }),
    )
  ).flat();

/**
 * One document's declarations, from its text.
 *
 * An outline is syntactic — the language server answers it from a parse of this
 * one file — but a request for it resolves to the project owning the file first
 * and builds that project's program. This inspection wants an outline three
 * times over: to resolve a name, to find what a position sits inside, and to
 * name a definition in another file. None of them are worth a program.
 */
const outline = async (workspace: VolarWorkspace, uri: string) =>
  documentSymbols({ uri, source: (await workspace.readTextDocumentUri(uri)).source }) ?? [];

/**
 * The declarations a bare name means in one file.
 *
 * Outermost wins when exactly one match is top level. A spread —
 * `...defaultMarks` inside another object — appears in the outline as a
 * property named for what it spreads, which made a symbol declared exactly
 * once read as ambiguous. Genuine ambiguity, two declarations at the same
 * level, stays ambiguous and returns both for the caller to choose between.
 */
export const declarationsNamed = (
  symbols: readonly DocumentSymbol[],
  uri: string,
  symbol: string,
): readonly Located[] => {
  const named = [...declarations(symbols, uri)].filter(({ name }) => name === symbol);
  const outermost = named.filter(({ within }) => within === undefined);
  return outermost.length === 1 ? outermost : named;
};

/**
 * The declaration a position sits in, named and kinded, from one syntactic outline.
 *
 * A result that reports only a count answers a question the reader has to
 * remember having asked, and a position that resolved to a neighbouring symbol
 * reads exactly like one that resolved correctly.
 */
export const declarationAtPosition = async (input: {
  readonly workspace: VolarWorkspace;
  readonly uri: string;
  readonly position: Position;
}): Promise<Located | undefined> =>
  enclosing({
    symbols: await outline(input.workspace, input.uri),
    position: input.position,
    uri: input.uri,
  });

/**
 * What stands at a position — the one owner of subject resolution.
 *
 * Every positional answer opens with a subject, and resolving it per tool
 * grew three mechanisms with four failure modes: hover prose misread a call
 * site as its enclosing assignment, the outline answered the container for
 * a member, and both could return nothing while the definition knew. The
 * definition request answers what the position RESOLVES TO; a
 * LocationLink's selection spans exactly the identifier, so the text under
 * it is the name. The outline answers only when the definition cannot.
 */
/** The words hover states a kind with; anything else is prose, not a kind. */
const hoverKinds = new Set([
  "const",
  "let",
  "var",
  "function",
  "local function",
  "method",
  "class",
  "interface",
  "type",
  "type parameter",
  "enum",
  "enum member",
  "namespace",
  "module",
  "property",
  "parameter",
  "alias",
  "getter",
  "setter",
  "accessor",
]);

/**
 * The kind word at a position, from hover, anchored and bounded.
 *
 * The syntactic outline has no entry for a type's members and reports the
 * enclosing type instead; hover states the kind itself, two ways —
 * parenthesised for things that are not declarations in their own right,
 * and as the declaring keyword otherwise. Unanchored matching once answered
 * "[or refinement]" from a hover's documentation prose, and storage words
 * yield to nature: a const whose type is callable is a function.
 */
const hoverKindAt = async (input: {
  readonly workspace: VolarWorkspace;
  readonly uri: string;
  readonly position: Position;
  readonly signal?: AbortSignal;
}): Promise<string | undefined> => {
  const hover = await input.workspace
    .sendRequest(
      HoverRequest.type,
      { textDocument: { uri: input.uri }, position: input.position },
      input.signal,
    )
    .catch(() => null);
  const contents = hover?.contents;
  const text =
    typeof contents === "object" && contents && "value" in contents ? String(contents.value) : "";
  const kind =
    /^(?:```\w*\s*)?\((?<kind>[a-z ]+)\)\s/.exec(text)?.groups?.kind ??
    /^(?:```\w*\s*)?(?<kind>const|let|var|function|class|interface|type|enum|namespace|module)\b/m.exec(
      text,
    )?.groups?.kind;
  const natured =
    kind !== undefined && ["const", "let", "var"].includes(kind) && /\)\s*=>/.test(text)
      ? "function"
      : kind;
  return natured !== undefined && hoverKinds.has(natured) ? natured : undefined;
};

export const subjectAtPosition = async (input: {
  readonly workspace: VolarWorkspace;
  readonly uri: string;
  readonly position: Position;
  readonly signal?: AbortSignal;
}): Promise<
  | {
      readonly name: string;
      readonly kind?: string;
      readonly declaredAt: { readonly uri: string; readonly selection: Range };
    }
  | undefined
> => {
  const [defined, kind] = await Promise.all([
    input.workspace
      .sendRequest(
        DefinitionRequest.type,
        { textDocument: { uri: input.uri }, position: input.position },
        input.signal,
      )
      .catch(() => null),
    hoverKindAt(input),
  ]);
  const first = (Array.isArray(defined) ? defined[0] : defined) as
    | { uri?: string; targetUri?: string; range?: Range; targetSelectionRange?: Range }
    | null
    | undefined;
  const uri = first?.targetUri ?? first?.uri;
  const selection = first?.targetSelectionRange ?? first?.range;
  const sliced =
    uri && selection
      ? await input.workspace
          .readTextDocumentUri(uri, input.signal)
          .then(({ source }) =>
            (source.split("\n")[selection.start.line] ?? "").slice(
              selection.start.character,
              selection.end.character,
            ),
          )
          .catch(() => undefined)
      : undefined;
  if (uri && selection && sliced && /^[$A-Za-z_][\w$]*$/u.test(sliced)) {
    return {
      name: sliced,
      ...(kind === undefined ? {} : { kind }),
      declaredAt: { uri, selection },
    };
  }
  // A plain Location's range spans the whole declaration — slicing it
  // yields nothing — and no definition at all leaves only the asked file.
  const declared = await declarationAtPosition({
    workspace: input.workspace,
    uri: uri ?? input.uri,
    position: selection?.start ?? input.position,
  }).catch(() => undefined);
  return declared?.name
    ? {
        name: declared.name,
        ...(kind === undefined ? {} : { kind }),
        declaredAt:
          uri && selection
            ? { uri, selection }
            : { uri: declared.uri, selection: declared.selectionRange },
      }
    : undefined;
};

/**
 * The declarations containing a position, outermost first.
 *
 * The innermost one is not always the useful answer. A reference standing on an
 * object-literal property *is* that property in the outline, so naming what
 * holds a use reported the use itself — `down: "↓"` inside `figures` answered
 * "inside down". A caller that wants the holder takes the last entry that is
 * not the reference, which needs the chain rather than its tip.
 */
export const declarationChainAtPosition = async (input: {
  readonly workspace: VolarWorkspace;
  readonly uri: string;
  readonly position: Position;
}): Promise<readonly Located[]> => {
  const chain = (symbols: readonly DocumentSymbol[]): readonly Located[] => {
    const branch = symbols.find(({ range }) => contains(range, input.position));
    return branch ? [located(branch, input.uri), ...chain(branch.children ?? [])] : [];
  };
  return chain(await outline(input.workspace, input.uri));
};

/** Whether a callable stands at one declaration's identifier. */
const declaredAt = (
  callable: { readonly uri: string; readonly selectionRange: Range },
  uri: string,
  selectionRange: Range,
) =>
  callable.uri === uri &&
  callable.selectionRange.start.line === selectionRange.start.line &&
  callable.selectionRange.start.character === selectionRange.start.character;

/**
 * Incoming calls, assembled from references and the syntactic outline.
 *
 * The call hierarchy's incoming direction answers nothing under the active
 * TypeScript backend — it returns in single-digit milliseconds without
 * searching — while references and the outline answer normally. A reference
 * whose enclosing declaration is not the symbol itself is a declaration that
 * uses the symbol, which is the relationship the incoming direction reports;
 * imports and re-exports sit in no declaration and fall out on their own.
 */
export const incomingCalls = async (input: {
  readonly workspace: VolarWorkspace;
  readonly references: readonly Location[] | null;
  readonly subject: CallHierarchyItem | undefined;
}): Promise<readonly CallHierarchyIncomingCall[]> => {
  const sources = await Promise.all(
    (input.references ?? []).map(async (location) => ({
      location,
      declaration: enclosingCallable({
        symbols: await outline(input.workspace, location.uri),
        position: location.range.start,
        uri: location.uri,
      }),
    })),
  );
  return sources.reduce<readonly CallHierarchyIncomingCall[]>(
    (callers, { location, declaration }) => {
      // A declaration the outline could not name is one an agent cannot go to,
      // so it is no more useful as a caller than the absence it stands in for.
      if (!declaration?.name || declaration.kind === undefined) return callers;
      // A reference standing exactly where its enclosing declaration is named is
      // that declaration, not a use inside one — the symbol's own definition, or
      // a shorthand property that is its own identifier.
      if (
        declaredAt(
          { uri: location.uri, selectionRange: location.range },
          location.uri,
          declaration.selectionRange,
        )
      ) {
        return callers;
      }
      if (input.subject && declaredAt(input.subject, location.uri, declaration.selectionRange)) {
        return callers;
      }
      const held = callers.find((call) =>
        declaredAt(call.from, location.uri, declaration.selectionRange),
      );
      const caller: CallHierarchyIncomingCall = {
        from: {
          name: declaration.name,
          kind: declaration.kind as CallHierarchyItem["kind"],
          uri: location.uri,
          range: declaration.range,
          selectionRange: declaration.selectionRange,
        },
        fromRanges: [location.range],
      };
      return held
        ? callers.map((call) =>
            call === held ? { ...call, fromRanges: [...call.fromRanges, location.range] } : call,
          )
        : [...callers, caller];
    },
    [],
  );
};

/**
 * The declaration a definition points at, in whichever file that is.
 *
 * A definition and the outline entry for it agree on their selection range, so
 * the two are matched. The document under inspection is already outlined; only
 * a definition in another file is read, and only inside the workspace.
 */
const declarationAt = async (input: {
  readonly workspace: VolarWorkspace;
  readonly root: string;
  readonly document: { readonly uri: string };
  readonly symbols: readonly DocumentSymbol[];
  readonly definition: Located | undefined;
}) => {
  const { definition } = input;
  if (!definition) return undefined;
  const local = definition.uri === input.document.uri;
  if (!local && !isFileInDir(slash(URI.parse(definition.uri).fsPath), slash(input.root))) {
    return undefined;
  }
  const symbols = local ? input.symbols : await outline(input.workspace, definition.uri);
  const wanted = key(definition);
  for (const symbol of declarations(symbols, definition.uri)) {
    if (key(symbol) === wanted) return symbol;
  }
  return undefined;
};

/**
 * Composes the language server's symbol, hover, navigation, reference, and call
 * hierarchy results into one bounded inspection.
 *
 * Name selection is exact within the requested document and reports ambiguity
 * rather than choosing a declaration. Position selection follows the language
 * server's normal resolution rules.
 */
export const inspectSymbol = async (input: {
  readonly workspace: VolarWorkspace;
  readonly root: string;
  readonly file: string;
  readonly target: InspectSymbolTarget;
  readonly options: InspectSymbolOptions;
  readonly signal: AbortSignal;
}): Promise<InspectSymbolResult> => {
  const { workspace, root, file, target, options, signal } = input;
  const textDocument = await workspace.getTextDocument(file);
  // Read and parsed here rather than asked of the language server, so resolving
  // a name never waits on a project. It answers two questions — which
  // declaration a name means, and what declaration a position falls in — from
  // one parse.
  const fileSymbols = await outline(workspace, textDocument.uri);
  // Walked once, keeping only what a name asked for. A position needs no walk.
  const matches =
    "symbol" in target ? declarationsNamed(fileSymbols, textDocument.uri, target.symbol) : [];
  if ("symbol" in target && matches.length !== 1) {
    const wanted = target.symbol.toLowerCase();
    const all = [...declarations(fileSymbols, textDocument.uri)];
    const similar = all.filter(({ name }) => name?.toLowerCase().includes(wanted));
    // A name that matches nothing is usually a typo, and a substring test does
    // not survive one — a transposed pair leaves the caller with no candidates
    // and the name it wanted sitting in the same file. The file's own
    // declarations are already parsed here, so showing them costs nothing and
    // answers the question the caller was actually asking.
    // The fallback lists what a caller could have meant, which is what the file
    // declares — not every binding inside those declarations. Walking the whole
    // outline offered `map() callback`, `by [method]` and `columns [property]`
    // as candidates for a name someone typed, and repeated one source line
    // across three of them. A substring match still searches the full depth,
    // since a nested name the caller half-remembered is worth finding.
    const topLevel = fileSymbols.map((symbol) => located(symbol, textDocument.uri));
    const candidates = matches.length ? matches : similar.length ? similar : topLevel;
    const shownCandidates = await withSourceLines(workspace, candidates.slice(0, options.limit));
    return {
      textDocument,
      choice: {
        reason: matches.length ? "ambiguous" : "not found",
        name: target.symbol,
        candidates: shownCandidates,
        total: candidates.length,
      },
    };
  }

  const selected = "symbol" in target ? matches[0]! : undefined;
  const position = "position" in target ? target.position : selected!.selectionRange.start;
  const [project, hover, definitionResult, implementationResult, referenceAnswer, items] =
    await Promise.all([
      workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal),
      workspace.sendRequest(HoverRequest.type, { textDocument, position }, signal),
      workspace.sendRequest(DefinitionRequest.type, { textDocument, position }, signal),
      workspace.sendRequest(ImplementationRequest.type, { textDocument, position }, signal),
      options.scope === "workspace"
        ? workspace.sendRequest(
            WorkspaceReferencesRequest.type,
            { textDocument, position, context: { includeDeclaration: true } },
            signal,
          )
        : workspace
            .sendRequest(
              ReferencesRequest.type,
              { textDocument, position, context: { includeDeclaration: true } },
              signal,
            )
            .then((locations) => ({
              locations: locations as Location[] | null,
              // Document scope asks the one project owning the file.
              projects: 1,
            })),
      workspace.sendRequest(CallHierarchyPrepareRequest.type, { textDocument, position }, signal),
    ]);
  const references = referenceAnswer?.locations ?? null;
  const searchedProjects = referenceAnswer?.projects ?? 0;
  const [incoming, outgoing] = await Promise.all([
    items
      ? [
          await incomingCalls({
            workspace,
            references,
            subject: items[0],
          }),
        ]
      : null,
    items
      ? Promise.all(
          items.map((item) =>
            workspace
              .sendRequest(CallHierarchyOutgoingCallsRequest.type, { item }, signal)
              .catch(() => null),
          ),
        )
      : null,
  ]);
  const definitions = navigationItems(definitionResult).map(locate);
  const implementations = navigationItems(implementationResult).map(locate);
  const callable = items?.[0];
  // A name target already chose its declaration, and a callable carries its own
  // identity from the call hierarchy. Everything else is a position in a file:
  // the declaration its definition points at, or failing that the one it sits
  // inside.
  const unnamed =
    selected || callable
      ? undefined
      : ((await declarationAt({
          workspace,
          root,
          document: textDocument,
          symbols: fileSymbols,
          definition: definitions[0],
        })) ?? enclosing({ symbols: fileSymbols, position, uri: textDocument.uri }));
  const base: Located =
    selected ??
    unnamed ??
    (callable
      ? {
          uri: callable.uri,
          name: callable.name,
          kind: callable.kind,
          range: callable.range,
          selectionRange: callable.selectionRange,
          ...(callable.detail ? { detail: callable.detail } : {}),
        }
      : (definitions[0] ?? {
          uri: textDocument.uri,
          range: { start: position, end: position },
          selectionRange: { start: position, end: position },
        }));
  const declaration = definitions.find((definition) => key(definition) === key(base));
  const primary: Located = {
    ...base,
    ...(callable
      ? {
          name: callable.name,
          kind: callable.kind,
          ...(callable.detail ? { detail: callable.detail } : {}),
        }
      : {}),
    ...(declaration
      ? { range: declaration.range, selectionRange: declaration.selectionRange }
      : {}),
  };
  const [source, typeResult] = await Promise.all([
    options.includeSource ? excerpt(workspace, primary) : undefined,
    options.includeTypeDefinitions
      ? workspace.sendRequest(TypeDefinitionRequest.type, { textDocument, position }, signal)
      : null,
  ]);
  const typeDefinitions = navigationItems(typeResult).map(locate);
  const callers = unique(
    incoming?.flatMap(
      (calls) =>
        calls?.map((call) => ({
          item: call.from,
          siteUri: call.from.uri,
          sites: unique(call.fromRanges, rangeText),
        })) ?? [],
    ) ?? [],
    ({ item, siteUri, sites }) => `${key(item)}\0${siteUri}\0${sites.map(rangeText).join(",")}`,
  );
  const callees = unique(
    outgoing?.flatMap(
      (calls, index) =>
        calls?.map((call) => ({
          item: call.to,
          siteUri: items?.[index]?.uri ?? textDocument.uri,
          sites: unique(call.fromRanges, rangeText),
        })) ?? [],
    ) ?? [],
    ({ item, siteUri, sites }) => `${key(item)}\0${siteUri}\0${sites.map(rangeText).join(",")}`,
  );
  const represented = new Set([
    key(primary),
    ...definitions.map(key),
    ...implementations.map(key),
    ...callers.flatMap(({ siteUri, sites }) =>
      sites.map((range) => key({ uri: siteUri, range, selectionRange: range })),
    ),
  ]);
  const allReferences =
    references?.map(({ uri, range }) => ({ uri, range, selectionRange: range })) ?? [];
  const otherReferences = allReferences.filter((reference) => !represented.has(key(reference)));
  const shownReferences = await withSourceLines(workspace, otherReferences.slice(0, options.limit));
  const extras = (items: readonly Located[]) => items.filter((item) => key(item) !== key(primary));
  const additionalDefinitions = extras(definitions);
  const distinctImplementations = extras(implementations).filter(
    (item) => !definitions.some((definition) => key(definition) === key(item)),
  );
  const distinctTypes = extras(typeDefinitions).filter(
    (item) =>
      !definitions.some((definition) => key(definition) === key(item)) &&
      !implementations.some((implementation) => key(implementation) === key(item)),
  );
  const siteUris = [...new Set(callees.map(({ siteUri }) => siteUri))];
  const sharedSiteUri = siteUris.length === 1 ? siteUris[0] : undefined;
  const name = primary.name ?? ("symbol" in target ? target.symbol : "Symbol");
  const hoverText = hover ? hoverContentsText(hover.contents) : undefined;

  // A jump target answered as a range alone makes the reader open the file to
  // learn what is there — `Type definitions (1) · 14:21-54:2` never said the
  // type is `Marks`, while the standalone tool for the same question does. The
  // outline at the target names it, and the outline for that file is usually
  // already parsed.
  const withDeclaredNames = async (items: readonly Located[]) =>
    Promise.all(
      items.map(async (item) => ({
        ...item,
        name:
          item.name ??
          (
            await declarationAtPosition({
              workspace,
              uri: item.uri,
              position: item.selectionRange.start,
            }).catch(() => undefined)
          )?.name,
      })),
    );
  return {
    textDocument,
    position,
    primary,
    name,
    project: project ? project.uri : undefined,
    hover: hoverText,
    additionalDefinitions: await withDeclaredNames(additionalDefinitions),
    implementations: await withDeclaredNames(distinctImplementations),
    typeDefinitions: await withDeclaredNames(distinctTypes),
    callers: items?.length ? callers : [],
    callees: items?.length ? callees : [],
    sharedCalleeUri: sharedSiteUri,
    compactExternalCalls: options.compactExternalCalls,
    limit: options.limit,
    references: {
      shown: shownReferences,
      projects: searchedProjects,
      other: otherReferences.length,
      total: allReferences.length,
    },
    source,
  };
};
