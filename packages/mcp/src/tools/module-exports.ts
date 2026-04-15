import path from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import type {
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  MarkupContent,
} from "vscode-languageserver-protocol";

const DEFAULT_MAX_RESULTS = 25;
const MAX_RESULTS = 100;
const PROBE_DIRECTORY = ".featuretype-mcp";

export interface ListedModuleExport {
  name: string;
  detail?: string;
  documentation?: string;
  kind?: CompletionItemKind;
  deprecated: boolean;
}

export interface ListModuleExportsResult {
  text: string;
  exports: ListedModuleExport[];
  module: string;
  query?: string;
  probeFile: string;
  totalExports: number;
  totalMatchingExports: number;
  offset: number;
  nextOffset: number | null;
  isIncomplete: boolean;
}

function clamp(value: number | undefined, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampOffset(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function sanitizeModuleSpecifier(moduleName: string): string {
  const sanitized = moduleName
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || "module";
}

function dedupeCompletionItems(items: CompletionItem[]): CompletionItem[] {
  const seen = new Set<string>();
  const deduped: CompletionItem[] = [];

  for (const item of items) {
    if (item.kind === 14 && item.label === "type") {
      continue;
    }

    const key = [
      item.label,
      item.kind ?? "",
      item.detail ?? "",
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function normalizeQuery(query: string | undefined): string | undefined {
  const trimmed = query?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function filterCompletionItems(
  items: CompletionItem[],
  query: string | undefined,
): CompletionItem[] {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return items;
  }

  const exactMatches: CompletionItem[] = [];
  const prefixMatches: CompletionItem[] = [];
  const substringMatches: CompletionItem[] = [];

  for (const item of items) {
    const normalizedLabel = item.label.toLowerCase();
    if (normalizedLabel === normalizedQuery) {
      exactMatches.push(item);
      continue;
    }

    if (normalizedLabel.startsWith(normalizedQuery)) {
      prefixMatches.push(item);
      continue;
    }

    if (normalizedLabel.includes(normalizedQuery)) {
      substringMatches.push(item);
    }
  }

  return exactMatches.length + prefixMatches.length > 0
    ? [...exactMatches, ...prefixMatches]
    : substringMatches;
}

function formatCompletionDocumentation(
  documentation: string | MarkupContent | undefined,
): string | undefined {
  if (!documentation) {
    return undefined;
  }

  return typeof documentation === "string"
    ? documentation
    : documentation.value;
}

function summarizeDocumentation(documentation: string | undefined): string | undefined {
  if (!documentation) {
    return undefined;
  }

  const trimmed = documentation.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  return normalized.length <= 120
    ? normalized
    : `${normalized.slice(0, 117)}...`;
}

function formatCompletionKind(kind: CompletionItemKind | undefined): string | undefined {
  switch (kind) {
    case 3:
      return "function";
    case 4:
      return "constructor";
    case 5:
      return "field";
    case 6:
      return "variable";
    case 7:
      return "class";
    case 8:
      return "interface";
    case 9:
      return "module";
    case 10:
      return "property";
    case 13:
      return "enum";
    case 14:
      return "keyword";
    case 17:
      return "file";
    case 22:
      return "struct";
    case 25:
      return "type-parameter";
    default:
      return undefined;
  }
}

function toListedExport(item: CompletionItem): ListedModuleExport {
  const documentation = formatCompletionDocumentation(item.documentation);
  return {
    name: item.label,
    detail: item.detail,
    documentation,
    kind: item.kind,
    deprecated: item.tags?.includes(1) ?? false,
  };
}

function formatExportLine(item: ListedModuleExport): string {
  const kind = formatCompletionKind(item.kind);
  const kindPrefix = kind ? `${kind} ` : "";
  const detail = item.detail ? ` — ${item.detail}` : "";
  const deprecated = item.deprecated ? " [deprecated]" : "";
  const summary = summarizeDocumentation(item.documentation);
  const docsLine = summary ? `\n  ${summary}` : "";
  return `- ${kindPrefix}${item.name}${deprecated}${detail}${docsLine}`;
}

function buildProbeFilePath(
  session: DiagnosticsSession,
  moduleName: string,
  fromFile?: string,
): string {
  const probeParent = fromFile
    ? path.dirname(path.resolve(session.rootDir, fromFile))
    : path.join(session.rootDir, PROBE_DIRECTORY);
  const safeModule = sanitizeModuleSpecifier(moduleName).slice(0, 80);
  return path.join(
    probeParent,
    `__list_module_exports__${safeModule}_${process.pid}.ts`,
  );
}

function buildProbeSource(moduleName: string): { content: string; position: { line: number; character: number } } {
  const prefix = "import { ";
  const suffix = ` } from ${JSON.stringify(moduleName)};\n`;
  return {
    content: `${prefix}${suffix}`,
    position: {
      line: 0,
      character: prefix.length,
    },
  };
}

function buildNoExportsMessage(
  moduleName: string,
  diagnostics: readonly Diagnostic[],
): string {
  const unresolved = diagnostics.find((diagnostic) => diagnostic.code === 2307);
  if (unresolved?.message) {
    return `Could not resolve module "${moduleName}": ${unresolved.message}`;
  }

  return `No exports found for "${moduleName}".`;
}

function findUnresolvedModuleDiagnostic(
  diagnostics: readonly Diagnostic[],
): Diagnostic | undefined {
  return diagnostics.find((diagnostic) => diagnostic.code === 2307);
}

function buildNoMatchingExportsMessage(
  moduleName: string,
  query: string,
  totalExports: number,
): string {
  if (totalExports === 0) {
    return `No exports found for "${moduleName}".`;
  }

  return `No exports found for "${moduleName}" matching "${query}".`;
}

function formatWindowLabel(
  totalMatchingExports: number,
  offset: number,
  visibleCount: number,
): string {
  if (totalMatchingExports === 0 || visibleCount === 0) {
    return "showing 0";
  }

  const start = offset + 1;
  const end = offset + visibleCount;
  return start === end ? `showing ${start}` : `showing ${start}-${end}`;
}

function buildRemainingExportsLine(
  remainingCount: number,
  query: string | undefined,
): string | undefined {
  if (remainingCount <= 0) {
    return undefined;
  }

  const qualifier = query ? "matching exports" : "exports";
  return `… ${remainingCount} more ${qualifier} omitted`;
}

function buildProgressHint(
  nextOffset: number | null,
  query: string | undefined,
): string | undefined {
  if (nextOffset === null) {
    return undefined;
  }

  return query
    ? `Hint: request offset ${nextOffset} to continue this query.`
    : `Hint: narrow with query or request offset ${nextOffset} for the next page.`;
}

export async function listModuleExports(
  session: DiagnosticsSession,
  args: {
    module: string;
    fromFile?: string;
    maxResults?: number;
    offset?: number;
    query?: string;
    includeDocs?: boolean;
  },
): Promise<ListModuleExportsResult> {
  const moduleName = args.module.trim();
  const maxResults = clamp(args.maxResults ?? DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
  const offset = clampOffset(args.offset);
  const query = args.query?.trim() || undefined;
  const includeDocs = args.includeDocs ?? true;

  if (!moduleName) {
    return {
      text: "list_module_exports requires a non-empty module specifier.",
      exports: [],
      module: moduleName,
      query,
      probeFile: "",
      totalExports: 0,
      totalMatchingExports: 0,
      offset,
      nextOffset: null,
      isIncomplete: false,
    };
  }

  const probeFile = buildProbeFilePath(session, moduleName, args.fromFile);
  const probe = buildProbeSource(moduleName);

  try {
    await session.openVirtualFile(probeFile, probe.content);
    const completions = await session.getFileCompletions(probeFile, probe.position);
    const diagnostics = await session.getFileDiagnostics(probeFile);
    const unresolvedModule = findUnresolvedModuleDiagnostic(diagnostics);

    if (unresolvedModule) {
      return {
        text: buildNoExportsMessage(moduleName, diagnostics),
        exports: [],
        module: moduleName,
        query,
        probeFile: path.relative(session.rootDir, probeFile),
        totalExports: 0,
        totalMatchingExports: 0,
        offset: 0,
        nextOffset: null,
        isIncomplete: completions.isIncomplete,
      };
    }

    const dedupedItems = dedupeCompletionItems(completions.items);
    const matchingItems = filterCompletionItems(dedupedItems, query);

    if (dedupedItems.length === 0) {
      return {
        text: buildNoExportsMessage(moduleName, diagnostics),
        exports: [],
        module: moduleName,
        query,
        probeFile: path.relative(session.rootDir, probeFile),
        totalExports: 0,
        totalMatchingExports: 0,
        offset,
        nextOffset: null,
        isIncomplete: completions.isIncomplete,
      };
    }

    if (matchingItems.length === 0) {
      return {
        text: buildNoMatchingExportsMessage(moduleName, query ?? "", dedupedItems.length),
        exports: [],
        module: moduleName,
        query,
        probeFile: path.relative(session.rootDir, probeFile),
        totalExports: dedupedItems.length,
        totalMatchingExports: 0,
        offset,
        nextOffset: null,
        isIncomplete: completions.isIncomplete,
      };
    }

    const maxPageOffset = Math.max(matchingItems.length - maxResults, 0);
    const pageOffset = Math.min(offset, maxPageOffset);
    const visibleItems = matchingItems.slice(pageOffset, pageOffset + maxResults);
    const nextOffset =
      pageOffset + visibleItems.length < matchingItems.length
        ? pageOffset + visibleItems.length
        : null;
    const resolvedItems = includeDocs
      ? await Promise.all(
        visibleItems.map((item) => session.resolveCompletionItem(item)),
      )
      : visibleItems;
    const exports = resolvedItems.map(toListedExport);
    const lines = exports.map(formatExportLine);
    const remainingLine = buildRemainingExportsLine(
      matchingItems.length - (pageOffset + visibleItems.length),
      query,
    );
    if (remainingLine) {
      lines.push(remainingLine);
    }

    if (completions.isIncomplete) {
      lines.push("… completion list is incomplete");
    }

    const progressHint = buildProgressHint(nextOffset, query);
    if (progressHint) {
      lines.push(progressHint);
    }

    const summaryBits = query
      ? [
        `"${moduleName}" matching "${query}"`,
        `(${matchingItems.length} of ${dedupedItems.length} total`,
        formatWindowLabel(matchingItems.length, pageOffset, visibleItems.length),
      ]
      : [
        `"${moduleName}"`,
        `(${dedupedItems.length} total`,
        formatWindowLabel(matchingItems.length, pageOffset, visibleItems.length),
      ];
    const summary = `${summaryBits[0]} ${summaryBits[1]}, ${summaryBits[2]}):`;

    return {
      text: `Exports from ${summary}\n${lines.join("\n")}`,
      exports,
      module: moduleName,
      query,
      probeFile: path.relative(session.rootDir, probeFile),
      totalExports: dedupedItems.length,
      totalMatchingExports: matchingItems.length,
      offset: pageOffset,
      nextOffset,
      isIncomplete: completions.isIncomplete,
    };
  } finally {
    await session.closeVirtualFile(probeFile).catch(() => undefined);
  }
}
