import * as path from "pathe";
import {
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  type CompletionItem,
  CompletionItemKind,
  type CompletionList,
  type Diagnostic,
  DiagnosticSeverity,
  type DocumentDiagnosticReport,
  type DocumentHighlight,
  DocumentHighlightKind,
  type DocumentLink,
  type DocumentSymbol,
  type Hover,
  type InlayHint,
  InlayHintKind,
  type Location,
  type LocationLink,
  type MarkupContent,
  type Position,
  type Range,
  type SelectionRange,
  type SignatureHelp,
  type SymbolInformation,
  SymbolKind,
  type WorkspaceSymbol,
} from "@volar/language-server/protocol.js";
import { URI } from "vscode-uri";
import type { ModuleExportPage } from "./module-exports.ts";

export type Page<Item> = {
  readonly total: number;
  readonly offset: number;
  readonly items: readonly Item[];
  readonly nextOffset?: number;
};

const enumName = (
  values: Record<string, number | ((value: number) => boolean)>,
  value: number | undefined,
  fallback: string,
) =>
  Object.entries(values)
    .find(([, candidate]) => candidate === value)?.[0]
    ?.replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase() ?? fallback;

export const workspacePath = (uri: string, workspaceRoot: string) => {
  try {
    const parsed = URI.parse(uri);
    if (parsed.scheme !== "file") return uri;
    const relative = path.relative(path.resolve(workspaceRoot), parsed.fsPath);
    return relative === ""
      ? "."
      : relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
        ? relative
        : parsed.fsPath;
  } catch {
    return uri;
  }
};

export const positionText = ({ line, character }: Position) => `${line + 1}:${character + 1}`;

export const rangeText = ({ start, end }: Range) => `${positionText(start)}-${positionText(end)}`;

export const workspaceRange = (uri: string, range: Range, workspaceRoot: string) =>
  `${workspacePath(uri, workspaceRoot)}:${rangeText(range)}`;

const indent = (value: string, prefix = "  ") =>
  value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");

const diagnosticSeverity = (diagnostic: Diagnostic) =>
  diagnostic.severity ?? DiagnosticSeverity.Error;

const diagnosticSeverityText = (diagnostic: Diagnostic) =>
  enumName(DiagnosticSeverity, diagnosticSeverity(diagnostic), "diagnostic");

const diagnosticOrigin = (diagnostic: Diagnostic) => {
  const source = diagnostic.source ?? "";
  const code = diagnostic.code === undefined ? "" : `(${diagnostic.code})`;
  return `${source}${code}`;
};

const diagnosticSummaryText = (diagnostic: Diagnostic, workspaceRoot: string) => {
  const origin = diagnosticOrigin(diagnostic);
  const related =
    diagnostic.relatedInformation?.map(
      (info) =>
        `related ${workspaceRange(
          info.location.uri,
          info.location.range,
          workspaceRoot,
        )}\n${indent(info.message, "    ")}`,
    ) ?? [];
  return [
    `${diagnosticSeverityText(diagnostic)}${origin ? ` ${origin}` : ""} ${rangeText(
      diagnostic.range,
    )}`,
    indent(diagnostic.message),
    ...related.map((line) => indent(line)),
  ].join("\n");
};

const comparePositions = (left: Position, right: Position) =>
  left.line - right.line || left.character - right.character;

export const diagnosticIntersects = (diagnostic: Diagnostic, focus: Position | Range) =>
  "line" in focus
    ? comparePositions(diagnostic.range.start, focus) <= 0 &&
      comparePositions(focus, diagnostic.range.end) < 0
    : comparePositions(diagnostic.range.start, focus.end) < 0 &&
      comparePositions(focus.start, diagnostic.range.end) < 0;

export const formatDiagnosticContext = (
  uri: string,
  report: DocumentDiagnosticReport | null | undefined,
  workspaceRoot: string,
  focus?: Position | Range,
): string | undefined => {
  if (!report || report.kind === "unchanged") return undefined;
  const actionable = report.items.filter(
    (diagnostic) => diagnosticSeverity(diagnostic) <= DiagnosticSeverity.Warning,
  );
  if (!actionable.length) return undefined;

  const errors = actionable.filter(
    (diagnostic) => diagnosticSeverity(diagnostic) === DiagnosticSeverity.Error,
  ).length;
  const warnings = actionable.length - errors;
  const counts = [
    errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : undefined,
    warnings ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : undefined,
  ]
    .filter((count): count is string => !!count)
    .join(", ");
  const preview =
    (focus
      ? actionable.find((diagnostic) => diagnosticIntersects(diagnostic, focus))
      : undefined) ?? actionable[0];

  return [
    `Diagnostics: ${counts} · ${workspacePath(uri, workspaceRoot)}`,
    diagnosticSummaryText(preview, workspaceRoot),
  ].join("\n");
};

type Markup =
  | string
  | MarkupContent
  | {
      readonly language: string;
      readonly value: string;
    }
  | undefined;

/**
 * Renders documentation markup as prose.
 *
 * Fences are removed because these values carry only documentation, where a
 * code block adds structure the text does not have.
 */
export const markupText = (value: Markup) => {
  const text = typeof value === "string" ? value : value?.value;
  return text?.replace(/^```[^\n]*\n?/gm, "").trim();
};

/**
 * Renders hover markup, keeping the fence that separates the declaration from
 * its documentation.
 *
 * A hover carries both a signature and prose. Removing the fence runs them
 * together, so an agent cannot tell which lines are the declaration and which
 * are the doc comment.
 */
export const hoverMarkupText = (value: Markup) =>
  value === undefined
    ? undefined
    : typeof value === "string"
      ? value.trim()
      : "language" in value
        ? `\`\`\`${value.language}\n${value.value.trim()}\n\`\`\``
        : value.value.trim();

const countHeader = (noun: string, count: number | string) =>
  `${noun[0]?.toUpperCase()}${noun.slice(1)} (${count})`;

const pageHeader = (noun: string, page: Page<unknown>) => {
  if (!page.total) return countHeader(noun, 0);
  if (page.offset === 0 && page.nextOffset === undefined) {
    return countHeader(noun, page.total);
  }
  const next = page.nextOffset === undefined ? "" : ` · next ${page.nextOffset}`;
  return `${countHeader(noun, `${page.items.length}/${page.total}`)} · offset ${page.offset}${next}`;
};

export const formatDiagnostics = (
  uri: string,
  report: DocumentDiagnosticReport | null | undefined,
  workspaceRoot: string,
): string => {
  const file = workspacePath(uri, workspaceRoot);
  if (!report) return `Diagnostics: unavailable · ${file}`;
  if (report.kind === "unchanged") {
    return `Diagnostics: unchanged · ${file}`;
  }
  if (!report.items.length) return "";
  const items = report.items.map((diagnostic) => {
    const severity = diagnosticSeverityText(diagnostic);
    const origin = diagnosticOrigin(diagnostic);
    const codeDescription = diagnostic.codeDescription?.href
      ? ` ${diagnostic.codeDescription.href}`
      : "";
    const tags = diagnostic.tags?.length
      ? ` [${diagnostic.tags.map((tag) => (tag === 1 ? "unnecessary" : "deprecated")).join(", ")}]`
      : "";
    const related =
      diagnostic.relatedInformation?.map(
        (info) =>
          `related ${workspaceRange(
            info.location.uri,
            info.location.range,
            workspaceRoot,
          )}\n${indent(info.message, "    ")}`,
      ) ?? [];
    return [
      `${severity}${origin ? ` ${origin}` : ""} ${rangeText(
        diagnostic.range,
      )}${tags}${codeDescription}`,
      indent(diagnostic.message),
      ...related.map((line) => indent(line)),
    ].join("\n");
  });
  return [`${countHeader("diagnostics", report.items.length)} · ${file}`, ...items].join("\n\n");
};

export const formatProjectDiagnostics = (
  project: string | null,
  fileCount: number,
  affectedFileCount: number,
  diagnostics: Page<{ readonly uri: string; readonly diagnostic: Diagnostic }>,
  workspaceRoot: string,
): string => {
  if (!diagnostics.total) return "";
  const grouped = new Map<string, { readonly uri: string; readonly diagnostic: Diagnostic }[]>();
  for (const item of diagnostics.items) {
    grouped.set(item.uri, [...(grouped.get(item.uri) ?? []), item]);
  }
  const body = [...grouped].map(([uri, items]) => {
    const report = {
      kind: "full" as const,
      items: items.map(({ diagnostic }) => diagnostic),
    };
    return formatDiagnostics(uri, report, workspaceRoot);
  });
  return [
    `Project diagnostics (${diagnostics.total}) · ${grouped.size} shown · ${affectedFileCount} affected · ${fileCount} files · ${
      project ? workspacePath(project, workspaceRoot) : "inferred project"
    }`,
    diagnostics.offset || diagnostics.nextOffset !== undefined
      ? `${pageHeader("diagnostics", diagnostics)}`
      : undefined,
    ...body,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n\n");
};

export const symbolKind = (kind: number) => enumName(SymbolKind, kind, "symbol");

const deprecatedSymbol = (symbol: {
  readonly deprecated?: boolean;
  readonly tags?: readonly number[];
}) => (symbol.deprecated || symbol.tags?.includes(1) ? " [deprecated]" : "");

const formatDocumentSymbol = (symbol: DocumentSymbol, level: number): string[] => {
  const selection = rangeText(symbol.selectionRange);
  const body = rangeText(symbol.range);
  const detail = symbol.detail ? ` — ${symbol.detail}` : "";
  const line = `${"  ".repeat(level)}${symbol.name} [${symbolKind(
    symbol.kind,
  )}]${deprecatedSymbol(symbol)} selection ${selection}${
    body === selection ? "" : `; body ${body}`
  }${detail}`;
  return [
    line,
    ...(symbol.children?.flatMap((child) => formatDocumentSymbol(child, level + 1)) ?? []),
  ];
};

export const formatDocumentSymbols = (
  uri: string,
  symbols: (DocumentSymbol | SymbolInformation)[] | null | undefined,
  workspaceRoot: string,
) => {
  const file = workspacePath(uri, workspaceRoot);
  if (!symbols?.length) return `Symbols (0) · ${file}`;
  const lines = symbols.flatMap((symbol) =>
    "range" in symbol
      ? formatDocumentSymbol(symbol, 0)
      : [
          `${symbol.name} [${symbolKind(symbol.kind)}]${deprecatedSymbol(symbol)} ${workspaceRange(
            symbol.location.uri,
            symbol.location.range,
            workspaceRoot,
          )}${symbol.containerName ? ` — ${symbol.containerName}` : ""}`,
        ],
  );
  return [`Symbols (${symbols.length} top-level) · ${file}`, ...lines].join("\n");
};

const documentLinkTarget = (target: string, workspaceRoot: string) => {
  const uri = URI.parse(target);
  const file = workspacePath(uri.with({ query: null, fragment: null }).toString(), workspaceRoot);
  return `${file}${uri.query ? `?${uri.query}` : ""}${uri.fragment ? `#${uri.fragment}` : ""}`;
};

export const formatDocumentLinks = (
  uri: string,
  links: readonly DocumentLink[],
  workspaceRoot: string,
) =>
  [
    `Links (${links.length}) · ${workspacePath(uri, workspaceRoot)}`,
    ...links.map(
      (link) =>
        `${rangeText(link.range)} -> ${
          link.target ? documentLinkTarget(link.target, workspaceRoot) : "unresolved"
        }${link.tooltip ? `\n${indent(link.tooltip)}` : ""}`,
    ),
  ].join("\n");

const selectionRangeChain = (selection: SelectionRange | undefined): readonly Range[] =>
  selection ? [selection.range, ...selectionRangeChain(selection.parent)] : [];

export const formatSelectionRanges = (
  uri: string,
  positions: readonly Position[],
  selections: readonly SelectionRange[] | null | undefined,
  workspaceRoot: string,
) =>
  [
    `Selection ranges (${selections?.length ?? 0}) · ${workspacePath(uri, workspaceRoot)}`,
    ...(selections ?? []).flatMap((selection, index) => [
      positionText(positions[index]),
      ...selectionRangeChain(selection).map((range) => `  ${rangeText(range)}`),
    ]),
  ].join("\n");

const workspaceSymbolLabel = (value: string) => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length <= 200 ? line : `${line.slice(0, 199)}…`;
};

const workspaceSymbolText = (
  symbol: WorkspaceSymbol | SymbolInformation,
  workspaceRoot: string,
) => {
  const location = symbol.location;
  const target =
    "range" in location && location.range
      ? workspaceRange(location.uri, location.range, workspaceRoot)
      : workspacePath(location.uri, workspaceRoot);
  return `${workspaceSymbolLabel(symbol.name)} [${symbolKind(symbol.kind)}]${deprecatedSymbol(
    symbol,
  )} ${target}${symbol.containerName ? ` — ${workspaceSymbolLabel(symbol.containerName)}` : ""}`;
};

export const formatWorkspaceSymbols = (
  page: Page<WorkspaceSymbol | SymbolInformation> | null | undefined,
  workspaceRoot: string,
) =>
  !page
    ? "Symbols (0)"
    : [
        pageHeader("symbols", page),
        ...page.items.map((symbol) => workspaceSymbolText(symbol, workspaceRoot)),
      ].join("\n");

export const hoverContentsText = (contents: Hover["contents"]) =>
  Array.isArray(contents)
    ? contents.map(hoverMarkupText).filter(Boolean).join("\n\n")
    : hoverMarkupText(contents);

export const formatHover = (
  uri: string,
  hover: Hover | null | undefined,
  workspaceRoot: string,
) => {
  const file = workspacePath(uri, workspaceRoot);
  if (!hover) return `Hover: none · ${file}`;
  const location = hover.range ? workspaceRange(uri, hover.range, workspaceRoot) : file;
  return [location, hoverContentsText(hover.contents) ?? "No hover content."].join("\n\n");
};

export const formatPositionQuery = (
  uri: string,
  position: Position,
  hover: Hover | null | undefined,
  workspaceRoot: string,
) => {
  const location = hover?.range
    ? workspaceRange(uri, hover.range, workspaceRoot)
    : `${workspacePath(uri, workspaceRoot)}:${positionText(position)}`;
  const identity = hoverContentsText(hover?.contents ?? [])
    ?.split("\n", 1)[0]
    ?.trim()
    .replace(/\{\s*$/, "…");
  return identity ? `Query: ${identity} · ${location}` : `Query: no symbol · ${location}`;
};

const parameterLabel = (signature: string, label: string | [number, number]) =>
  typeof label === "string" ? label : signature.slice(label[0], label[1]);

export const formatSignatureHelp = (help: SignatureHelp | null | undefined) => {
  if (!help?.signatures.length) return "Signatures (0)";
  const activeSignature = help.activeSignature ?? 0;
  const activeParameter =
    help.signatures[activeSignature]?.activeParameter ?? help.activeParameter ?? 0;
  const signatures = help.signatures.flatMap((signature, signatureIndex) => {
    const documentation = markupText(signature.documentation);
    const signatureActiveParameter = signature.activeParameter ?? activeParameter;
    const parameters =
      signature.parameters?.map((parameter, parameterIndex) => {
        const marker =
          signatureIndex === activeSignature && parameterIndex === signatureActiveParameter
            ? ">"
            : " ";
        const docs = markupText(parameter.documentation);
        return `  ${marker} ${parameterLabel(
          signature.label,
          parameter.label,
        )}${docs ? ` — ${docs}` : ""}`;
      }) ?? [];
    return [
      `${signatureIndex === activeSignature ? ">" : " "} ${signature.label}`,
      ...(documentation ? [indent(documentation)] : []),
      ...parameters,
    ];
  });
  return [
    `${countHeader("signatures", help.signatures.length)} · active ${activeSignature} · parameter ${activeParameter}`,
    ...signatures,
  ].join("\n");
};

export type CompletionPage = Page<CompletionItem> & {
  readonly isIncomplete: boolean;
  readonly itemDefaults?: CompletionList["itemDefaults"];
};

const editText = (item: CompletionItem) => {
  if (item.textEdit) {
    const range =
      "range" in item.textEdit
        ? rangeText(item.textEdit.range)
        : `insert ${rangeText(item.textEdit.insert)}; replace ${rangeText(item.textEdit.replace)}`;
    return `edit ${range} => ${item.textEdit.newText}`;
  }
  const insertion = item.textEditText ?? item.insertText;
  return insertion && insertion !== item.label ? `insert ${insertion}` : undefined;
};

const completionText = (item: CompletionItem) => {
  const kind = enumName(CompletionItemKind, item.kind, "completion");
  const label = `${item.label}${item.labelDetails?.detail ?? ""}`;
  const description = item.labelDetails?.description ? ` — ${item.labelDetails.description}` : "";
  const deprecated =
    (item as { readonly deprecated?: boolean }).deprecated || item.tags?.includes(1)
      ? " [deprecated]"
      : "";
  const documentation = markupText(item.documentation);
  const edit = editText(item);
  const additionalEdits =
    item.additionalTextEdits?.map(
      (additional) => `additional edit ${rangeText(additional.range)} => ${additional.newText}`,
    ) ?? [];
  const command = item.command
    ? `command ${item.command.title} (${item.command.command})`
    : undefined;
  return [
    `${label} [${kind}]${deprecated}${description}${item.detail ? ` — ${item.detail}` : ""}`,
    ...(documentation ? [indent(documentation)] : []),
    ...[edit, ...additionalEdits, command]
      .filter((line): line is string => !!line)
      .map((line) => indent(line)),
  ].join("\n");
};

export const formatCompletions = (page: CompletionPage | null | undefined) => {
  if (!page) return "Completions (0)";
  const state = page.isIncomplete ? " · more available" : "";
  const defaults = page.itemDefaults?.editRange
    ? `Default edit: ${
        "insert" in page.itemDefaults.editRange
          ? `insert ${rangeText(page.itemDefaults.editRange.insert)}; replace ${rangeText(
              page.itemDefaults.editRange.replace,
            )}`
          : rangeText(page.itemDefaults.editRange)
      }`
    : undefined;
  return [
    `${pageHeader("completions", page)}${state}`,
    ...(defaults ? [defaults] : []),
    ...page.items.map(completionText),
  ].join("\n");
};

const moduleDeclaration = (input: {
  readonly item: CompletionItem;
  readonly qualifier: string;
  readonly includeDocs: boolean;
  readonly documentationLimit?: number;
}) => {
  const { item, qualifier, includeDocs, documentationLimit } = input;
  const rawDocumentation = includeDocs ? markupText(item.documentation) : undefined;
  const documentation =
    documentationLimit === undefined
      ? rawDocumentation
      : rawDocumentation
          ?.split(/\n\s*\n/u)[0]
          ?.replace(/\s+/gu, " ")
          .replace(/\s+([,.;:!?])/gu, "$1")
          .trim();
  const boundedDocumentation =
    documentationLimit !== undefined && documentation && documentation.length > documentationLimit
      ? `${documentation.slice(0, documentationLimit - 1).trimEnd()}…`
      : documentation;
  const deprecated =
    (item as { readonly deprecated?: boolean }).deprecated || item.tags?.includes(1);
  const comment = [deprecated ? "@deprecated" : undefined, boundedDocumentation]
    .filter(Boolean)
    .join("\n");
  const escapedLabel = item.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const detail = item.detail
    ?.replace(/^\([^)]+\)\s*/u, "")
    .replace(new RegExp(`\\b[\\w$]+_exports\\.${escapedLabel}\\b`, "g"), item.label)
    .replace(/\b__module\./gu, "")
    .replace(new RegExp(`^[^\\n]*\\.${escapedLabel}(?=\\s*[:(<])`, "u"), item.label)
    .replace(/\nexport[^\n]*$/u, "");
  const unqualified = detail?.startsWith(`${qualifier}.`)
    ? detail.slice(qualifier.length + 1)
    : detail;
  const rootDeclaration = unqualified ? `export ${unqualified}` : `export { ${item.label} };`;
  const declaration = qualifier ? (unqualified ?? item.label) : rootDeclaration;
  const terminated = qualifier && !declaration.endsWith(";") ? `${declaration};` : declaration;
  const singleLineJSDoc = comment ? `/** ${comment.replace(/\*\//gu, "*\\/")} */` : undefined;
  const multilineJSDoc = comment
    ? [
        "/**",
        ...comment.split("\n").map((line) => ` * ${line.replace(/\*\//gu, "*\\/")}`),
        " */",
      ].join("\n")
    : undefined;
  const jsdoc = comment?.includes("\n") ? multilineJSDoc : singleLineJSDoc;
  return [...(jsdoc ? [jsdoc] : []), terminated].join("\n");
};

export const formatModuleDeclarations = (input: {
  readonly items: readonly CompletionItem[];
  readonly qualifier?: string;
  readonly includeDocs: boolean;
  readonly documentationLimit?: number;
}) =>
  [
    "```ts",
    ...input.items.flatMap((item, index) => [
      moduleDeclaration({
        item,
        qualifier: input.qualifier ?? "",
        includeDocs: input.includeDocs,
        documentationLimit: input.documentationLimit,
      }),
      ...(index + 1 < input.items.length ? [""] : []),
    ]),
    "```",
  ].join("\n");

export const formatModuleExports = (page: ModuleExportPage) => {
  const target = [page.module, ...(page.type ? [page.type] : []), ...page.path].join(".");
  const context = [
    target,
    page.type ? "type members" : page.surface,
    ...(page.query ? [`query ${JSON.stringify(page.query)}`] : []),
    ...(page.isIncomplete ? ["more available"] : []),
  ].join(" · ");
  return [
    `${pageHeader(page.type ? "members" : "exports", page)} · ${context}`,
    ...(page.resolved === false
      ? ["Module could not be resolved from the selected project context."]
      : []),
    ...(page.items.length
      ? [
          formatModuleDeclarations({
            items: page.items,
            qualifier: [page.type, ...page.path].filter(Boolean).join("."),
            includeDocs: page.includeDocs,
          }),
        ]
      : []),
    ...(page.subpaths.length
      ? [
          "",
          `Subpaths (${page.subpaths.length})`,
          ...page.subpaths.map((subpath) => `${page.module}/${subpath}`),
        ]
      : []),
  ].join("\n");
};

type NavigationResult = Location | readonly Location[] | readonly LocationLink[] | null | undefined;

const navigationText = (item: Location | LocationLink, workspaceRoot: string) => {
  if ("targetUri" in item) {
    const target = workspaceRange(item.targetUri, item.targetSelectionRange, workspaceRoot);
    const body = rangeText(item.targetRange);
    const origin = item.originSelectionRange
      ? `; origin ${rangeText(item.originSelectionRange)}`
      : "";
    return `${target}; body ${body}${origin}`;
  }
  return workspaceRange(item.uri, item.range, workspaceRoot);
};

export const formatNavigation = (noun: string, result: NavigationResult, workspaceRoot: string) => {
  const items = !result ? [] : Array.isArray(result) ? result : [result];
  if (!items.length) return countHeader(noun, 0);
  return [
    countHeader(noun, items.length),
    ...items.map((item) => navigationText(item, workspaceRoot)),
  ].join("\n");
};

export const formatLocationPage = (
  noun: string,
  page: Page<Location> | null | undefined,
  workspaceRoot: string,
) =>
  !page
    ? countHeader(noun, 0)
    : [
        pageHeader(noun, page),
        ...page.items.map((item) => workspaceRange(item.uri, item.range, workspaceRoot)),
      ].join("\n");

export const formatDocumentHighlights = (
  uri: string,
  highlights: readonly DocumentHighlight[] | null | undefined,
  workspaceRoot: string,
) => {
  const file = workspacePath(uri, workspaceRoot);
  if (!highlights?.length) return `Highlights (0) · ${file}`;
  return [
    `${countHeader("highlights", highlights.length)} · ${file}`,
    ...highlights.map(
      (highlight) =>
        `${enumName(DocumentHighlightKind, highlight.kind, "text")} ${rangeText(highlight.range)}`,
    ),
  ].join("\n");
};

const inlayLabel = (hint: InlayHint) =>
  typeof hint.label === "string" ? hint.label : hint.label.map((part) => part.value).join("");

export const formatInlayHints = (
  uri: string,
  hints: readonly InlayHint[] | null | undefined,
  workspaceRoot: string,
) => {
  const file = workspacePath(uri, workspaceRoot);
  if (!hints?.length) return `Inlay hints (0) · ${file}`;
  return [
    `${countHeader("inlay hints", hints.length)} · ${file}`,
    ...hints.flatMap((hint) => {
      const tooltip = markupText(hint.tooltip);
      return [
        `${enumName(InlayHintKind, hint.kind, "hint")} ${positionText(
          hint.position,
        )} — ${inlayLabel(hint)}`,
        ...(tooltip ? [indent(tooltip)] : []),
      ];
    }),
  ].join("\n");
};

export type CallHierarchyResult = {
  readonly prepareCallHierarchy: readonly CallHierarchyItem[] | null;
  readonly incomingCalls?: readonly (readonly CallHierarchyIncomingCall[] | null)[] | null;
  readonly outgoingCalls?: readonly (readonly CallHierarchyOutgoingCall[] | null)[] | null;
};

const callItemText = (item: CallHierarchyItem, workspaceRoot: string) =>
  `${item.name} [${symbolKind(item.kind)}]${deprecatedSymbol(item)} ${workspaceRange(
    item.uri,
    item.selectionRange,
    workspaceRoot,
  )}${
    rangeText(item.range) === rangeText(item.selectionRange)
      ? ""
      : `; body ${rangeText(item.range)}`
  }${item.detail ? ` — ${item.detail}` : ""}`;

export const formatCallHierarchy = (
  direction: "incoming" | "outgoing",
  result: CallHierarchyResult,
  workspaceRoot: string,
) => {
  const items = result.prepareCallHierarchy ?? [];
  const relation = direction === "incoming" ? "caller" : "callee";
  const relations = `${relation}s`;
  if (!items.length) return `${relations[0]?.toUpperCase()}${relations.slice(1)}: none`;
  const groups = items.flatMap((item, index) => {
    const calls =
      direction === "incoming" ? result.incomingCalls?.[index] : result.outgoingCalls?.[index];
    const relatedItems =
      calls?.map((call) => {
        const target = "from" in call ? call.from : call.to;
        return `  ${relation} ${callItemText(
          target,
          workspaceRoot,
        )}; call sites ${call.fromRanges.map(rangeText).join(", ")}`;
      }) ?? [];
    return [
      callItemText(item, workspaceRoot),
      ...(relatedItems.length ? relatedItems : [`  no ${relations}`]),
    ];
  });
  return groups.join("\n");
};

export const formatProjectConfig = (
  result: { readonly uri: string } | null | undefined,
  workspaceRoot: string,
) =>
  result
    ? `TypeScript project: ${workspacePath(result.uri, workspaceRoot)}`
    : "TypeScript project: inferred";

export const formatProjectScope = (
  result: { readonly uri: string } | null | undefined,
  workspaceRoot: string,
) =>
  result
    ? `Scope: project only · ${workspacePath(result.uri, workspaceRoot)}`
    : "Scope: inferred project only";

export const formatWorkspaceSymbolScope = (
  result: { readonly uri: string } | null | undefined,
  workspaceRoot: string,
) => {
  const anchor = result ? workspacePath(result.uri, workspaceRoot) : "inferred project";
  return `Scope: loaded projects · anchor ${anchor}`;
};
