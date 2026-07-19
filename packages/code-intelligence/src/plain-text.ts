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
  type DocumentSymbol,
  type Hover,
  type InlayHint,
  InlayHintKind,
  type Location,
  type LocationLink,
  type MarkupContent,
  type Position,
  type Range,
  type SignatureHelp,
  type SymbolInformation,
  SymbolKind,
  type WorkspaceSymbol,
} from "@volar/language-server/protocol.js";
import { URI } from "vscode-uri";

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
    return relative === "" ? "." : relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      ? relative
      : parsed.fsPath;
  } catch {
    return uri;
  }
};

export const positionText = ({ line, character }: Position) =>
  `${line}:${character}`;

export const rangeText = ({ start, end }: Range) =>
  `${positionText(start)}-${positionText(end)}`;

export const workspaceRange = (
  uri: string,
  range: Range,
  workspaceRoot: string,
) => `${workspacePath(uri, workspaceRoot)}:${rangeText(range)}`;

const indent = (value: string, prefix = "  ") =>
  value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");

const diagnosticSeverity = (diagnostic: Diagnostic) =>
  diagnostic.severity ?? DiagnosticSeverity.Error;

const diagnosticSeverityText = (diagnostic: Diagnostic) =>
  enumName(
    DiagnosticSeverity,
    diagnosticSeverity(diagnostic),
    "diagnostic",
  );

const diagnosticOrigin = (diagnostic: Diagnostic) => {
  const source = diagnostic.source ?? "";
  const code = diagnostic.code === undefined ? "" : `(${diagnostic.code})`;
  return `${source}${code}`;
};

const diagnosticSummaryText = (diagnostic: Diagnostic) => {
  const origin = diagnosticOrigin(diagnostic);
  return [
    `${diagnosticSeverityText(diagnostic)}${origin ? ` ${origin}` : ""} ${
      rangeText(diagnostic.range)
    }`,
    indent(diagnostic.message),
  ].join("\n");
};

const comparePositions = (left: Position, right: Position) =>
  left.line - right.line || left.character - right.character;

export const diagnosticIntersects = (
  diagnostic: Diagnostic,
  focus: Position | Range,
) =>
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
  const actionable = report.items.filter((diagnostic) =>
    diagnosticSeverity(diagnostic) <= DiagnosticSeverity.Warning
  );
  if (!actionable.length) return undefined;

  const errors = actionable.filter((diagnostic) =>
    diagnosticSeverity(diagnostic) === DiagnosticSeverity.Error
  ).length;
  const warnings = actionable.length - errors;
  const counts = [
    errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : undefined,
    warnings
      ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}`
      : undefined,
  ].filter((count): count is string => !!count).join(", ");
  const focused = focus
    ? actionable.find((diagnostic) => diagnosticIntersects(diagnostic, focus))
    : undefined;

  return [
    `Diagnostics: ${counts} · ${workspacePath(uri, workspaceRoot)}`,
    ...(focused ? [diagnosticSummaryText(focused)] : []),
    "Full report: diagnostics",
  ].join("\n");
};

const markupText = (
  value: string | MarkupContent | {
    readonly language: string;
    readonly value: string;
  } | undefined,
) => {
  const text = typeof value === "string" ? value : value?.value;
  return text
    ?.replace(/^```[^\n]*\n?/gm, "")
    .trim();
};

const countHeader = (noun: string, count: number | string) =>
  `${noun[0]?.toUpperCase()}${noun.slice(1)} (${count})`;

const pageHeader = (noun: string, page: Page<unknown>) => {
  if (!page.total) return countHeader(noun, 0);
  if (page.offset === 0 && page.nextOffset === undefined) {
    return countHeader(noun, page.total);
  }
  const next = page.nextOffset === undefined
    ? ""
    : ` · next ${page.nextOffset}`;
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
      ? ` [${
        diagnostic.tags.map((tag) => tag === 1 ? "unnecessary" : "deprecated")
          .join(", ")
      }]`
      : "";
    const related = diagnostic.relatedInformation?.map((info) =>
      `related ${
        workspaceRange(info.location.uri, info.location.range, workspaceRoot)
      }\n${indent(info.message, "    ")}`
    ) ?? [];
    return [
      `${severity}${origin ? ` ${origin}` : ""} ${
        rangeText(diagnostic.range)
      }${tags}${codeDescription}`,
      indent(diagnostic.message),
      ...related.map((line) =>
        indent(line)
      ),
    ].join("\n");
  });
  return [
    `${countHeader("diagnostics", report.items.length)} · ${file}`,
    ...items,
  ].join("\n\n");
};

export const symbolKind = (kind: number) =>
  enumName(SymbolKind, kind, "symbol");

const deprecatedSymbol = (
  symbol: { readonly deprecated?: boolean; readonly tags?: readonly number[] },
) => symbol.deprecated || symbol.tags?.includes(1) ? " [deprecated]" : "";

const formatDocumentSymbol = (
  symbol: DocumentSymbol,
  level: number,
): string[] => {
  const selection = rangeText(symbol.selectionRange);
  const body = rangeText(symbol.range);
  const detail = symbol.detail ? ` — ${symbol.detail}` : "";
  const line = `${"  ".repeat(level)}${symbol.name} [${
    symbolKind(symbol.kind)
  }]${deprecatedSymbol(symbol)} selection ${selection}${
    body === selection ? "" : `; body ${body}`
  }${detail}`;
  return [
    line,
    ...symbol.children?.flatMap((child) =>
      formatDocumentSymbol(child, level + 1)
    ) ?? [],
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
    "range" in symbol ? formatDocumentSymbol(symbol, 0) : [
      `${symbol.name} [${symbolKind(symbol.kind)}]${deprecatedSymbol(symbol)} ${
        workspaceRange(symbol.location.uri, symbol.location.range, workspaceRoot)
      }${symbol.containerName ? ` — ${symbol.containerName}` : ""}`,
    ]
  );
  return [`Symbols (${symbols.length} top-level) · ${file}`, ...lines].join("\n");
};

const workspaceSymbolText = (
  symbol: WorkspaceSymbol | SymbolInformation,
  workspaceRoot: string,
) => {
  const location = symbol.location;
  const target = "range" in location && location.range
    ? workspaceRange(location.uri, location.range, workspaceRoot)
    : workspacePath(location.uri, workspaceRoot);
  return `${symbol.name} [${symbolKind(symbol.kind)}]${
    deprecatedSymbol(symbol)
  } ${target}${symbol.containerName ? ` — ${symbol.containerName}` : ""}`;
};

export const formatWorkspaceSymbols = (
  page: Page<WorkspaceSymbol | SymbolInformation> | null | undefined,
  workspaceRoot: string,
) =>
  !page ? "Symbols (0)" : [
    pageHeader("symbols", page),
    ...page.items.map((symbol) => workspaceSymbolText(symbol, workspaceRoot)),
  ]
    .join("\n");

export const hoverContentsText = (contents: Hover["contents"]) =>
  Array.isArray(contents)
    ? contents.map(markupText).filter(Boolean).join("\n\n")
    : markupText(contents);

export const formatHover = (
  uri: string,
  hover: Hover | null | undefined,
  workspaceRoot: string,
) => {
  const file = workspacePath(uri, workspaceRoot);
  if (!hover) return `Hover: none · ${file}`;
  const location = hover.range
    ? workspaceRange(uri, hover.range, workspaceRoot)
    : file;
  return [location, hoverContentsText(hover.contents) ?? "No hover content."]
    .join("\n\n");
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
  return identity
    ? `Query: ${identity} · ${location}`
    : `Query: no symbol · ${location}`;
};

const parameterLabel = (
  signature: string,
  label: string | [number, number],
) => typeof label === "string" ? label : signature.slice(label[0], label[1]);

export const formatSignatureHelp = (
  help: SignatureHelp | null | undefined,
) => {
  if (!help?.signatures.length) return "Signatures (0)";
  const activeSignature = help.activeSignature ?? 0;
  const activeParameter = help.signatures[activeSignature]?.activeParameter ??
    help.activeParameter ?? 0;
  const signatures = help.signatures.flatMap((signature, signatureIndex) => {
    const documentation = markupText(signature.documentation);
    const signatureActiveParameter = signature.activeParameter ??
      activeParameter;
    const parameters =
      signature.parameters?.map((parameter, parameterIndex) => {
        const marker = signatureIndex === activeSignature &&
            parameterIndex === signatureActiveParameter
          ? ">"
          : " ";
        const docs = markupText(parameter.documentation);
        return `  ${marker} ${
          parameterLabel(signature.label, parameter.label)
        }${docs ? ` — ${docs}` : ""}`;
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
    const range = "range" in item.textEdit
      ? rangeText(item.textEdit.range)
      : `insert ${rangeText(item.textEdit.insert)}; replace ${
        rangeText(item.textEdit.replace)
      }`;
    return `edit ${range} => ${item.textEdit.newText}`;
  }
  const insertion = item.textEditText ?? item.insertText;
  return insertion && insertion !== item.label
    ? `insert ${insertion}`
    : undefined;
};

const completionText = (item: CompletionItem) => {
  const kind = enumName(CompletionItemKind, item.kind, "completion");
  const label = `${item.label}${item.labelDetails?.detail ?? ""}`;
  const description = item.labelDetails?.description
    ? ` — ${item.labelDetails.description}`
    : "";
  const deprecated = (item as { readonly deprecated?: boolean }).deprecated ||
      item.tags?.includes(1)
    ? " [deprecated]"
    : "";
  const documentation = markupText(item.documentation);
  const edit = editText(item);
  const additionalEdits =
    item.additionalTextEdits?.map((additional) =>
      `additional edit ${rangeText(additional.range)} => ${additional.newText}`
    ) ?? [];
  const command = item.command
    ? `command ${item.command.title} (${item.command.command})`
    : undefined;
  return [
    `${label} [${kind}]${deprecated}${description}${
      item.detail ? ` — ${item.detail}` : ""
    }`,
    ...(documentation ? [indent(documentation)] : []),
    ...[edit, ...additionalEdits, command].filter((line): line is string =>
      !!line
    ).map((line) => indent(line)),
  ].join("\n");
};

export const formatCompletions = (
  page: CompletionPage | null | undefined,
) => {
  if (!page) return "Completions (0)";
  const state = page.isIncomplete ? " · more available" : "";
  const defaults = page.itemDefaults?.editRange
    ? `Default edit: ${
      "insert" in page.itemDefaults.editRange
        ? `insert ${rangeText(page.itemDefaults.editRange.insert)}; replace ${
          rangeText(page.itemDefaults.editRange.replace)
        }`
        : rangeText(page.itemDefaults.editRange)
    }`
    : undefined;
  return [
    `${pageHeader("completions", page)}${state}`,
    ...(defaults ? [defaults] : []),
    ...page.items.map(completionText),
  ].join("\n");
};

type NavigationResult =
  | Location
  | readonly Location[]
  | readonly LocationLink[]
  | null
  | undefined;

const navigationText = (
  item: Location | LocationLink,
  workspaceRoot: string,
) => {
  if ("targetUri" in item) {
    const target = workspaceRange(
      item.targetUri,
      item.targetSelectionRange,
      workspaceRoot,
    );
    const body = rangeText(item.targetRange);
    const origin = item.originSelectionRange
      ? `; origin ${rangeText(item.originSelectionRange)}`
      : "";
    return `${target}; body ${body}${origin}`;
  }
  return workspaceRange(item.uri, item.range, workspaceRoot);
};

export const formatNavigation = (
  noun: string,
  result: NavigationResult,
  workspaceRoot: string,
) => {
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
  !page ? countHeader(noun, 0) : [
    pageHeader(noun, page),
    ...page.items.map((item) =>
      workspaceRange(item.uri, item.range, workspaceRoot)
    ),
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
    ...highlights.map((highlight) =>
      `${enumName(DocumentHighlightKind, highlight.kind, "text")} ${
        rangeText(highlight.range)
      }`
    ),
  ].join("\n");
};

const inlayLabel = (hint: InlayHint) =>
  typeof hint.label === "string"
    ? hint.label
    : hint.label.map((part) => part.value).join("");

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
        `${enumName(InlayHintKind, hint.kind, "hint")} ${
          positionText(hint.position)
        } — ${inlayLabel(hint)}`,
        ...(tooltip ? [indent(tooltip)] : []),
      ];
    }),
  ].join("\n");
};

export type CallHierarchyResult = {
  readonly prepareCallHierarchy: readonly CallHierarchyItem[] | null;
  readonly incomingCalls?:
    | readonly (readonly CallHierarchyIncomingCall[] | null)[]
    | null;
  readonly outgoingCalls?:
    | readonly (readonly CallHierarchyOutgoingCall[] | null)[]
    | null;
};

const callItemText = (item: CallHierarchyItem, workspaceRoot: string) =>
  `${item.name} [${symbolKind(item.kind)}]${deprecatedSymbol(item)} ${
    workspaceRange(item.uri, item.selectionRange, workspaceRoot)
  }${
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
    const calls = direction === "incoming"
      ? result.incomingCalls?.[index]
      : result.outgoingCalls?.[index];
    const relatedItems = calls?.map((call) => {
      const target = "from" in call ? call.from : call.to;
      return `  ${relation} ${
        callItemText(target, workspaceRoot)
      }; call sites ${call.fromRanges.map(rangeText).join(", ")}`;
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
  const anchor = result
    ? workspacePath(result.uri, workspaceRoot)
    : "inferred project";
  return `Scope: loaded projects · anchor ${anchor}`;
};
