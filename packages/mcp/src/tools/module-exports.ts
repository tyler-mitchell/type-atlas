import path from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import type {
  CompletionItem,
  Diagnostic,
} from "vscode-languageserver-protocol";

const DEFAULT_MAX_RESULTS = 25;
const MAX_RESULTS = 100;
const PROBE_DIRECTORY = ".featuretype-mcp";
const SURFACE_PROBE_BATCH_SIZE = 64;
const NON_RUNTIME_VALUE_DIAGNOSTIC_CODES = new Set<number>([
  1484,
  1485,
  2585,
  2690,
  2693,
  2708,
]);

export type ModuleExportSurface = "runtime" | "all";

export interface ListedModuleExport {
  name: string;
  detail?: string;
  deprecated: boolean;
}

export interface ListModuleExportsResult {
  text: string;
  module: string;
  query?: string;
  surface: ModuleExportSurface;
  probeFile: string;
  totalExports: number;
  totalMatchingExports: number;
  hiddenExportCount: number;
  offset: number;
  nextOffset: number | null;
  pageItemCount: number;
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

function normalizeSurface(value: string | undefined): ModuleExportSurface {
  return value === "all" ? "all" : "runtime";
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
    if (item.kind === 14) {
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

function chunkItems<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

type SurfaceProbeEntry = {
  item: CompletionItem;
  importLine: number;
  usageLine: number;
};

function buildSurfaceProbeSource(
  moduleName: string,
  items: CompletionItem[],
): {
  content: string;
  entries: SurfaceProbeEntry[];
} {
  const entries = items.map((item, index) => ({
    item,
    importLine: index * 2,
    usageLine: index * 2 + 1,
  }));

  const lines = entries.flatMap(({ item }, index) => {
    const alias = `__featuretype_value_probe_${index}`;
    return [
      `import { ${item.label} as ${alias} } from ${JSON.stringify(moduleName)};`,
      `void ${alias};`,
    ];
  });

  return {
    content: `${lines.join("\n")}\n`,
    entries,
  };
}

function isNonRuntimeValueDiagnostic(diagnostic: Diagnostic): boolean {
  return typeof diagnostic.code === "number" &&
    NON_RUNTIME_VALUE_DIAGNOSTIC_CODES.has(diagnostic.code);
}

function collectNonRuntimeProbeIndexes(
  diagnostics: readonly Diagnostic[],
  entries: readonly SurfaceProbeEntry[],
): Set<number> {
  const entryIndexByLine = new Map(
    entries.flatMap((entry, index) => [
      [entry.importLine, index] as const,
      [entry.usageLine, index] as const,
    ]),
  );

  return new Set(
    diagnostics
      .filter(isNonRuntimeValueDiagnostic)
      .map((diagnostic) => entryIndexByLine.get(diagnostic.range.start.line))
      .filter((index): index is number => index !== undefined),
  );
}

async function classifyRuntimeSurfaceBatch(
  session: DiagnosticsSession,
  moduleName: string,
  fromFile: string | undefined,
  items: CompletionItem[],
  batchIndex: number,
): Promise<{
  visibleItems: CompletionItem[];
  hiddenExportCount: number;
}> {
  if (items.length === 0) {
    return {
      visibleItems: [],
      hiddenExportCount: 0,
    };
  }

  const probeFile = buildProbeFilePath(
    session,
    moduleName,
    fromFile,
    `surface_${batchIndex}`,
  );
  const probe = buildSurfaceProbeSource(moduleName, items);

  try {
    await session.openVirtualFile(probeFile, probe.content);
    const diagnostics = await session.getFileDiagnostics(probeFile);
    const hiddenIndexes = collectNonRuntimeProbeIndexes(diagnostics, probe.entries);

    return {
      visibleItems: items.filter((_, index) => !hiddenIndexes.has(index)),
      hiddenExportCount: hiddenIndexes.size,
    };
  } finally {
    await session.closeVirtualFile(probeFile).catch(() => undefined);
  }
}

async function filterCompletionItemsBySurface(
  session: DiagnosticsSession,
  moduleName: string,
  fromFile: string | undefined,
  items: CompletionItem[],
  surface: ModuleExportSurface,
): Promise<{
  visibleItems: CompletionItem[];
  hiddenExportCount: number;
}> {
  if (surface === "all" || items.length === 0) {
    return {
      visibleItems: items,
      hiddenExportCount: 0,
    };
  }

  const batches = chunkItems(items, SURFACE_PROBE_BATCH_SIZE);
  return await batches.reduce(
    async (resultPromise, batch, batchIndex) => {
      const result = await resultPromise;
      const classifiedBatch = await classifyRuntimeSurfaceBatch(
        session,
        moduleName,
        fromFile,
        batch,
        batchIndex,
      );

      return {
        visibleItems: [...result.visibleItems, ...classifiedBatch.visibleItems],
        hiddenExportCount: result.hiddenExportCount + classifiedBatch.hiddenExportCount,
      };
    },
    Promise.resolve({
      visibleItems: [] as CompletionItem[],
      hiddenExportCount: 0,
    }),
  );
}

function toListedExport(item: CompletionItem): ListedModuleExport {
  return {
    name: item.label,
    detail: item.detail,
    deprecated: item.tags?.includes(1) ?? false,
  };
}

function normalizeDetail(
  detail: string | undefined,
  exportName: string,
): string | undefined {
  const trimmed = detail?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  const trailingExportLabel = new RegExp(`\\s+export\\s+${exportName}$`);
  return normalized.replace(trailingExportLabel, "");
}

function formatExportLine(item: ListedModuleExport): string {
  const normalizedDetail = normalizeDetail(item.detail, item.name);
  const detail = normalizedDetail ? ` — ${normalizedDetail}` : "";
  const deprecated = item.deprecated ? " [deprecated]" : "";
  return `- ${item.name}${deprecated}${detail}`;
}

function buildProbeFilePath(
  session: DiagnosticsSession,
  moduleName: string,
  fromFile?: string,
  purpose?: string,
): string {
  const probeParent = fromFile
    ? path.dirname(path.resolve(session.rootDir, fromFile))
    : path.join(session.rootDir, PROBE_DIRECTORY);
  const safeModule = sanitizeModuleSpecifier(moduleName).slice(0, 80);
  const safePurpose = purpose ? `_${sanitizeModuleSpecifier(purpose)}` : "";
  return path.join(
    probeParent,
    `__list_module_exports${safePurpose}__${safeModule}_${process.pid}.ts`,
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
  surface: ModuleExportSurface,
  totalExports: number,
  hiddenExportCount: number,
): string {
  if (totalExports === 0) {
    return `No exports found for "${moduleName}".`;
  }

  if (surface === "runtime" && hiddenExportCount > 0) {
    return `No runtime exports found for "${moduleName}" matching "${query}". ${hiddenExportCount} type-like exports match; retry with surface "all" to include them.`;
  }

  return `No exports found for "${moduleName}" matching "${query}".`;
}

function buildNoVisibleExportsMessage(
  moduleName: string,
  surface: ModuleExportSurface,
  totalExports: number,
  hiddenExportCount: number,
): string {
  if (totalExports === 0) {
    return `No exports found for "${moduleName}".`;
  }

  if (surface === "runtime" && hiddenExportCount > 0) {
    return `No runtime exports found for "${moduleName}". ${hiddenExportCount} type-like exports are available; retry with surface "all" to include them.`;
  }

  return `No exports found for "${moduleName}".`;
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
    surface?: ModuleExportSurface;
  },
): Promise<ListModuleExportsResult> {
  const moduleName = args.module.trim();
  const maxResults = clamp(args.maxResults ?? DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
  const offset = clampOffset(args.offset);
  const query = args.query?.trim() || undefined;
  const includeDocs = args.includeDocs ?? true;
  const surface = normalizeSurface(args.surface);

  if (!moduleName) {
    return {
      text: "list_module_exports requires a non-empty module specifier.",
      module: moduleName,
      query,
      surface,
      probeFile: "",
      totalExports: 0,
      totalMatchingExports: 0,
      hiddenExportCount: 0,
      offset,
      nextOffset: null,
      pageItemCount: 0,
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
        module: moduleName,
        query,
        surface,
        probeFile: path.relative(session.rootDir, probeFile),
        totalExports: 0,
        totalMatchingExports: 0,
        hiddenExportCount: 0,
        offset: 0,
        nextOffset: null,
        pageItemCount: 0,
        isIncomplete: completions.isIncomplete,
      };
    }

    const dedupedItems = dedupeCompletionItems(completions.items);
    const queriedItems = filterCompletionItems(dedupedItems, query);
    const surfacePreparedItems =
      includeDocs && surface === "runtime"
        ? await Promise.all(queriedItems.map((item) => session.resolveCompletionItem(item)))
        : queriedItems;
    const {
      visibleItems: matchingItems,
      hiddenExportCount,
    } = await filterCompletionItemsBySurface(
      session,
      moduleName,
      args.fromFile,
      surfacePreparedItems,
      surface,
    );

    if (dedupedItems.length === 0) {
      return {
        text: buildNoExportsMessage(moduleName, diagnostics),
        module: moduleName,
        query,
        surface,
        probeFile: path.relative(session.rootDir, probeFile),
        totalExports: 0,
        totalMatchingExports: 0,
        hiddenExportCount: 0,
        offset,
        nextOffset: null,
        pageItemCount: 0,
        isIncomplete: completions.isIncomplete,
      };
    }

    if (matchingItems.length === 0) {
      return {
        text: query
          ? buildNoMatchingExportsMessage(
            moduleName,
            query,
            surface,
            queriedItems.length,
            hiddenExportCount,
          )
          : buildNoVisibleExportsMessage(
            moduleName,
            surface,
            dedupedItems.length,
            hiddenExportCount,
          ),
        module: moduleName,
        query,
        surface,
        probeFile: path.relative(session.rootDir, probeFile),
        totalExports: dedupedItems.length,
        totalMatchingExports: 0,
        hiddenExportCount,
        offset,
        nextOffset: null,
        pageItemCount: 0,
        isIncomplete: completions.isIncomplete,
      };
    }

    const maxPageOffset =
      Math.floor(Math.max(matchingItems.length - 1, 0) / maxResults) * maxResults;
    const pageOffset = Math.min(offset, maxPageOffset);
    const visibleItems = matchingItems.slice(pageOffset, pageOffset + maxResults);
    const nextOffset =
      pageOffset + visibleItems.length < matchingItems.length
        ? pageOffset + visibleItems.length
        : null;
    const resolvedItems = includeDocs && surface === "all"
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
        surface === "runtime" && hiddenExportCount > 0
          ? `(${matchingItems.length} runtime matches, ${hiddenExportCount} type-like hidden`
          : `(${matchingItems.length} of ${queriedItems.length} matching`,
        formatWindowLabel(matchingItems.length, pageOffset, visibleItems.length),
      ]
      : [
        `"${moduleName}"`,
        surface === "runtime" && hiddenExportCount > 0
          ? `(${matchingItems.length} runtime exports, ${hiddenExportCount} type-like hidden`
          : `(${dedupedItems.length} total`,
        formatWindowLabel(matchingItems.length, pageOffset, visibleItems.length),
      ];
    const summary = `${summaryBits[0]} ${summaryBits[1]}, ${summaryBits[2]}):`;

    return {
      text: `Exports from ${summary}\n${lines.join("\n")}`,
      module: moduleName,
      query,
      surface,
      probeFile: path.relative(session.rootDir, probeFile),
      totalExports: dedupedItems.length,
      totalMatchingExports: matchingItems.length,
      hiddenExportCount,
      offset: pageOffset,
      nextOffset,
      pageItemCount: exports.length,
      isIncomplete: completions.isIncomplete,
    };
  } finally {
    await session.closeVirtualFile(probeFile).catch(() => undefined);
  }
}
