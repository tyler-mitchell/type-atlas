import * as path from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import { URI } from "vscode-uri";
import {
  DocumentSymbol,
  SymbolKind,
  type Hover,
  type Location,
  type Range,
  type SymbolInformation,
  type WorkspaceSymbol,
} from "vscode-languageserver-protocol";
import { explainFailure } from "../failure.js";
import {
  excludeSemanticLocations,
  formatSemanticLocation,
} from "./semantic-locations.js";
import { formatSignatureHelp } from "./signature-help.js";

const DEFAULT_MAX_DEPTH = 1;
const DEFAULT_MAX_ITEMS = 25;
const DEFAULT_MAX_REFERENCES = 8;
const DEFAULT_WORKSPACE_MAX_RESULTS = 25;

const DEFAULT_OUTLINE_KINDS = new Set<number>([
  SymbolKind.Module,
  SymbolKind.Namespace,
  SymbolKind.Class,
  SymbolKind.Method,
  SymbolKind.Constructor,
  SymbolKind.Enum,
  SymbolKind.Interface,
  SymbolKind.Function,
  SymbolKind.Variable,
  SymbolKind.Constant,
  SymbolKind.Struct,
]);

type AnyWorkspaceDocumentSymbol = DocumentSymbol | SymbolInformation;

type FlattenedSymbol = {
  name: string;
  kind?: number;
  detail?: string;
  depth: number;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
};

function isDocumentSymbol(
  symbol: AnyWorkspaceDocumentSymbol,
): symbol is DocumentSymbol {
  return DocumentSymbol.is(symbol);
}

function flattenSymbols(
  symbols: AnyWorkspaceDocumentSymbol[],
  depth = 0,
): FlattenedSymbol[] {
  const entries: FlattenedSymbol[] = [];

  for (const symbol of symbols) {
    if (isDocumentSymbol(symbol)) {
      entries.push({
        name: symbol.name,
        kind: symbol.kind,
        detail: symbol.detail,
        depth,
        range: symbol.range,
        selectionRange: symbol.selectionRange ?? symbol.range,
        children: symbol.children,
      });
      if (symbol.children?.length) {
        entries.push(...flattenSymbols(symbol.children, depth + 1));
      }
      continue;
    }

    entries.push({
      name: symbol.name,
      kind: symbol.kind,
      depth,
      range: symbol.location.range,
      selectionRange: symbol.location.range,
    });
  }

  return entries;
}

function clamp(value: number | undefined, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function formatSymbolKindLabel(kind: number | undefined): string | null {
  switch (kind) {
    case SymbolKind.File:
      return "file";
    case SymbolKind.Module:
      return "module";
    case SymbolKind.Namespace:
      return "namespace";
    case SymbolKind.Package:
      return "package";
    case SymbolKind.Class:
      return "class";
    case SymbolKind.Method:
      return "method";
    case SymbolKind.Property:
      return "property";
    case SymbolKind.Field:
      return "field";
    case SymbolKind.Constructor:
      return "constructor";
    case SymbolKind.Enum:
      return "enum";
    case SymbolKind.Interface:
      return "interface";
    case SymbolKind.Function:
      return "function";
    case SymbolKind.Variable:
      return "variable";
    case SymbolKind.Constant:
      return "constant";
    case SymbolKind.String:
      return "string";
    case SymbolKind.Number:
      return "number";
    case SymbolKind.Boolean:
      return "boolean";
    case SymbolKind.Array:
      return "array";
    case SymbolKind.Object:
      return "object";
    case SymbolKind.Key:
      return "key";
    case SymbolKind.Null:
      return "null";
    case SymbolKind.EnumMember:
      return "enum-member";
    case SymbolKind.Struct:
      return "struct";
    case SymbolKind.Event:
      return "event";
    case SymbolKind.Operator:
      return "operator";
    case SymbolKind.TypeParameter:
      return "type-parameter";
    default:
      return null;
  }
}

function formatHoverContents(hover: Hover): string {
  if (typeof hover.contents === "string") {
    return hover.contents;
  }
  if (Array.isArray(hover.contents)) {
    return hover.contents
      .map((content) => (typeof content === "string" ? content : content.value))
      .join("\n\n");
  }
  return hover.contents.value;
}

function formatReferenceLocation(rootDir: string, location: Location): string {
  const referencePath = path.relative(rootDir, URI.parse(location.uri).fsPath);
  const line = location.range.start.line + 1;
  const col = location.range.start.character + 1;
  return `${referencePath}:${line}:${col}`;
}

function normalizeSyntheticSymbolName(symbol: FlattenedSymbol): {
  kindLabel?: string;
  name: string;
} {
  const registerToolMatch = symbol.name.match(
    /^.+\.registerTool\("([^"]+)"\) callback$/,
  );
  if (registerToolMatch) {
    return {
      kindLabel: "tool",
      name: registerToolMatch[1],
    };
  }

  return {
    name: symbol.name,
  };
}

function formatSymbolLine(symbol: FlattenedSymbol): string {
  const indent = "  ".repeat(symbol.depth);
  const normalized = normalizeSyntheticSymbolName(symbol);
  const kindLabel =
    normalized.kindLabel ?? formatSymbolKindLabel(symbol.kind);
  const labelPrefix = kindLabel ? `${kindLabel} ` : "";
  const detail = symbol.detail ? ` — ${symbol.detail}` : "";
  const line = symbol.selectionRange.start.line + 1;
  const col = symbol.selectionRange.start.character + 1;
  return `${indent}${labelPrefix}${normalized.name}${detail} (line ${line}:${col})`;
}

function isDefaultOutlineSymbol(symbol: FlattenedSymbol): boolean {
  return symbol.kind ? DEFAULT_OUTLINE_KINDS.has(symbol.kind) : symbol.depth === 0;
}

function scoreSymbolMatch(symbol: FlattenedSymbol, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return -1;
  }

  const name = symbol.name.toLowerCase();
  const detail = (symbol.detail ?? "").toLowerCase();

  if (name === normalizedQuery) return 400;
  if (name.startsWith(normalizedQuery)) return 300;
  if (name.includes(normalizedQuery)) return 200;
  if (detail.includes(normalizedQuery)) return 100;
  return -1;
}

function dedupeLines(lines: string[]): string[] {
  return [...new Set(lines)];
}

function formatWorkspaceSymbolLine(rootDir: string, symbol: WorkspaceSymbol): string {
  const kindLabel = formatSymbolKindLabel(symbol.kind);
  const kindPrefix = kindLabel ? `${kindLabel} ` : "";
  const container = symbol.containerName ? ` — ${symbol.containerName}` : "";
  const targetPath = path.relative(rootDir, URI.parse(symbol.location.uri).fsPath);
  if ("range" in symbol.location) {
    const line = symbol.location.range.start.line + 1;
    const col = symbol.location.range.start.character + 1;
    return `${targetPath}:${line}:${col} ${kindPrefix}${symbol.name}${container}`;
  }
  return `${targetPath} ${kindPrefix}${symbol.name}${container}`;
}

type WorkspaceSymbolMatch = {
  rootDir: string;
  symbol: WorkspaceSymbol;
};

function getWorkspaceSymbolKey(match: WorkspaceSymbolMatch): string {
  const rangeKey = "range" in match.symbol.location
    ? [
        match.symbol.location.range.start.line,
        match.symbol.location.range.start.character,
        match.symbol.location.range.end.line,
        match.symbol.location.range.end.character,
      ].join(":")
    : "";

  return [
    match.rootDir,
    match.symbol.name,
    match.symbol.kind,
    match.symbol.containerName ?? "",
    match.symbol.location.uri,
    rangeKey,
  ].join("|");
}

function dedupeWorkspaceSymbolMatches(
  matches: WorkspaceSymbolMatch[],
): WorkspaceSymbolMatch[] {
  const seen = new Set<string>();
  const deduped: WorkspaceSymbolMatch[] = [];

  for (const match of matches) {
    const key = getWorkspaceSymbolKey(match);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(match);
  }

  return deduped;
}

export async function getDocumentSymbolsOutline(
  session: DiagnosticsSession,
  args: {
    file: string;
    query?: string;
    maxDepth?: number;
    maxItems?: number;
  },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const symbols = await session.getFileDocumentSymbols(absPath);
  if (!symbols.length) {
    return `No symbols found in ${args.file}`;
  }

  const maxDepth = clamp(args.maxDepth ?? DEFAULT_MAX_DEPTH, 1, 5);
  const maxItems = clamp(args.maxItems ?? DEFAULT_MAX_ITEMS, 1, 100);
  const query = args.query?.trim();
  const flattened = flattenSymbols(symbols);

  let selected = query
    ? flattened
        .map((symbol) => ({ symbol, score: scoreSymbolMatch(symbol, query) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.symbol.depth !== b.symbol.depth) return a.symbol.depth - b.symbol.depth;
          if (a.symbol.selectionRange.start.line !== b.symbol.selectionRange.start.line) {
            return a.symbol.selectionRange.start.line - b.symbol.selectionRange.start.line;
          }
          return a.symbol.selectionRange.start.character - b.symbol.selectionRange.start.character;
        })
        .map((entry) => entry.symbol)
    : flattened.filter(
        (symbol) =>
          symbol.depth < maxDepth &&
          (symbol.depth === 0 || isDefaultOutlineSymbol(symbol)),
      );

  if (!query && selected.length === 0) {
    selected = flattened.filter((symbol) => symbol.depth === 0);
  }

  if (selected.length === 0) {
    return `No symbols matching "${query}" found in ${args.file}`;
  }

  const visible = selected.slice(0, maxItems);
  const lines = visible.map(formatSymbolLine);
  if (selected.length > visible.length) {
    lines.push(`… ${selected.length - visible.length} more symbols omitted`);
  }

  return query ? `Matches for "${query}" in ${args.file}:\n${lines.join("\n")}` : lines.join("\n");
}

export async function searchWorkspaceSymbols(
  session: DiagnosticsSession,
  args: {
    query: string;
    maxResults?: number;
  },
): Promise<{
  text: string;
  symbols: WorkspaceSymbol[];
  totalSymbols: number;
}> {
  const query = args.query.trim();
  if (!query) {
    return {
      text: "search_workspace_symbols requires a non-empty query.",
      symbols: [],
      totalSymbols: 0,
    };
  }

  const maxResults = clamp(
    args.maxResults ?? DEFAULT_WORKSPACE_MAX_RESULTS,
    1,
    100,
  );
  const symbols = await session.getWorkspaceSymbols(query);

  if (symbols.length === 0) {
    return {
      text: `No workspace symbols matching "${query}" found.`,
      symbols: [],
      totalSymbols: 0,
    };
  }

  const visibleSymbols = symbols.slice(0, maxResults);
  const lines = visibleSymbols.map((symbol) =>
    formatWorkspaceSymbolLine(session.rootDir, symbol),
  );
  if (symbols.length > visibleSymbols.length) {
    lines.push(`… ${symbols.length - visibleSymbols.length} more symbols omitted`);
  }

  return {
    text: `Workspace matches for "${query}" (${symbols.length} results):\n${lines.join("\n")}`,
    symbols: visibleSymbols,
    totalSymbols: symbols.length,
  };
}

export async function searchWorkspaceSymbolsAcrossSessions(
  sessions: DiagnosticsSession[],
  args: {
    query: string;
    maxResults?: number;
  },
): Promise<{
  text: string;
  symbols: WorkspaceSymbol[];
  totalSymbols: number;
  roots: string[];
}> {
  const query = args.query.trim();
  if (!query) {
    return {
      text: "search_workspace_symbols requires a non-empty query.",
      symbols: [],
      totalSymbols: 0,
      roots: [],
    };
  }

  const roots = [...new Set(sessions.map((session) => session.rootDir))];
  if (roots.length === 0) {
    return {
      text: "No attached projects are available for workspace symbol search.",
      symbols: [],
      totalSymbols: 0,
      roots: [],
    };
  }

  const maxResults = clamp(
    args.maxResults ?? DEFAULT_WORKSPACE_MAX_RESULTS,
    1,
    100,
  );
  const matchesBySession = await Promise.all(
    sessions.map(async (session) => ({
      rootDir: session.rootDir,
      matches: (await session.getWorkspaceSymbols(query)).map((symbol) => ({
        rootDir: session.rootDir,
        symbol,
      })),
    })),
  );
  const matches = dedupeWorkspaceSymbolMatches(
    matchesBySession.flatMap((sessionResult) => sessionResult.matches),
  );

  if (matches.length === 0) {
    return {
      text: `No workspace symbols matching "${query}" found.`,
      symbols: [],
      totalSymbols: 0,
      roots,
    };
  }

  const visibleMatches = matches.slice(0, maxResults);
  const lines: string[] = [];

  if (roots.length === 1) {
    lines.push(
      ...visibleMatches.map(({ rootDir, symbol }) =>
        formatWorkspaceSymbolLine(rootDir, symbol)
      ),
    );
  } else {
    const visibleByRoot = new Map<string, WorkspaceSymbol[]>();
    for (const { rootDir, symbol } of visibleMatches) {
      const existing = visibleByRoot.get(rootDir) ?? [];
      existing.push(symbol);
      visibleByRoot.set(rootDir, existing);
    }

    for (const rootDir of roots) {
      const rootSymbols = visibleByRoot.get(rootDir);
      if (!rootSymbols || rootSymbols.length === 0) {
        continue;
      }
      lines.push(`[${rootDir}]`);
      lines.push(
        ...rootSymbols.map((symbol) => `  ${formatWorkspaceSymbolLine(rootDir, symbol)}`),
      );
    }
  }

  if (matches.length > visibleMatches.length) {
    lines.push(`… ${matches.length - visibleMatches.length} more symbols omitted`);
  }

  const scopeText = roots.length > 1
    ? ` across ${roots.length} attached projects`
    : "";

  return {
    text: `Workspace matches for "${query}" (${matches.length} results${scopeText}):\n${lines.join("\n")}`,
    symbols: visibleMatches.map((match) => match.symbol),
    totalSymbols: matches.length,
    roots,
  };
}

export async function inspectSymbol(
  session: DiagnosticsSession,
  args: {
    file: string;
    line?: number;
    col?: number;
    query?: string;
    maxReferences?: number;
  },
): Promise<string> {
  const hasLine = typeof args.line === "number";
  const hasCol = typeof args.col === "number";
  const query = args.query?.trim();

  if ((hasLine && !hasCol) || (!hasLine && hasCol)) {
    return "inspect_symbol requires both line and col when using a position.";
  }

  if (!query && !hasLine && !hasCol) {
    return "inspect_symbol requires either line/col or query.";
  }

  const absPath = path.resolve(session.rootDir, args.file);
  let position =
    hasLine && hasCol
      ? { line: (args.line ?? 1) - 1, character: (args.col ?? 1) - 1 }
      : null;
  let matchedSymbol: FlattenedSymbol | null = null;

  if (!position && query) {
    const symbols = await session.getFileDocumentSymbols(absPath);
    matchedSymbol =
      flattenSymbols(symbols)
        .map((symbol) => ({ symbol, score: scoreSymbolMatch(symbol, query) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.symbol.depth !== b.symbol.depth) return a.symbol.depth - b.symbol.depth;
          if (a.symbol.selectionRange.start.line !== b.symbol.selectionRange.start.line) {
            return a.symbol.selectionRange.start.line - b.symbol.selectionRange.start.line;
          }
          return a.symbol.selectionRange.start.character - b.symbol.selectionRange.start.character;
        })[0]?.symbol ?? null;

    if (!matchedSymbol) {
      return `No symbol matching "${query}" found in ${args.file}`;
    }

    position = matchedSymbol.selectionRange.start;
  }

  const resolvedPosition = position ?? { line: 0, character: 0 };
  const maxReferences = clamp(
    args.maxReferences ?? DEFAULT_MAX_REFERENCES,
    1,
    20,
  );

  const [hover, signatureHelp, definitions, typeDefinitions, implementations, references] = await Promise.all([
    session.getFileHover(absPath, resolvedPosition),
    session.getFileSignatureHelp(absPath, resolvedPosition),
    session.getFileDefinition(absPath, resolvedPosition),
    session.getFileTypeDefinition(absPath, resolvedPosition),
    session.getFileImplementations(absPath, resolvedPosition),
    session.getFileReferences(absPath, resolvedPosition),
  ]);

  if (
    !hover &&
    definitions.length === 0 &&
    typeDefinitions.length === 0 &&
    implementations.length === 0 &&
    references.length === 0
  ) {
    return explainFailure("inspect_symbol", args.file, session, {
      position: `${resolvedPosition.line + 1}:${resolvedPosition.character + 1}`,
      hint: query ? `No semantic information was found for "${query}".` : undefined,
    });
  }

  const sections: string[] = [];
  if (matchedSymbol && query) {
    sections.push(`Matched "${query}" -> ${formatSymbolLine(matchedSymbol).trim()}`);
    const memberLines = (matchedSymbol.children ?? [])
      .map((child) =>
        flattenSymbols([child], matchedSymbol.depth + 1).find((entry) => entry.depth === matchedSymbol.depth + 1),
      )
      .filter((symbol): symbol is FlattenedSymbol => Boolean(symbol))
      .filter(isDefaultOutlineSymbol)
      .slice(0, 8)
      .map((symbol) => `  ${formatSymbolLine(symbol).trim()}`);

    if (memberLines.length > 0) {
      sections.push(`Members:\n${memberLines.join("\n")}`);
    }
  }

  if (hover) {
    sections.push(`Type / hover:\n${formatHoverContents(hover)}`);
  }

  if (signatureHelp && signatureHelp.signatures.length > 0) {
    sections.push(`Signature:\n${formatSignatureHelp(signatureHelp)}`);
  }

  const definitionLines = dedupeLines(
    definitions.map((location) => formatSemanticLocation(session.rootDir, location)),
  );
  if (definitionLines.length > 0) {
    sections.push(`Definition:\n${definitionLines.join("\n")}`);
  }

  const typeDefinitionLines = dedupeLines(
    typeDefinitions.map((location) => formatSemanticLocation(session.rootDir, location)),
  );
  if (typeDefinitionLines.length > 0) {
    sections.push(`Type definition:\n${typeDefinitionLines.join("\n")}`);
  }

  const distinctImplementations = excludeSemanticLocations(
    implementations,
    definitions,
  );
  const implementationLines = dedupeLines(
    distinctImplementations.map((location) =>
      formatSemanticLocation(session.rootDir, location)
    ),
  );
  if (implementationLines.length > 0) {
    sections.push(`Implementations (${implementationLines.length}):\n${implementationLines.join("\n")}`);
  } else if (implementations.length > 0) {
    sections.push(
      [
        "Implementations:",
        "No distinct implementations found.",
        "The language server resolved the symbol's own definition.",
      ].join("\n"),
    );
  }

  const referenceLines = dedupeLines(
    references.map((location) => formatReferenceLocation(session.rootDir, location)),
  );
  if (referenceLines.length > 0) {
    const visibleReferences = referenceLines.slice(0, maxReferences);
    const suffix =
      referenceLines.length > visibleReferences.length
        ? `\n… ${referenceLines.length - visibleReferences.length} more references omitted`
        : "";
    sections.push(
      `References (${referenceLines.length}):\n${visibleReferences.join("\n")}${suffix}`,
    );
  }

  return sections.join("\n\n");
}
