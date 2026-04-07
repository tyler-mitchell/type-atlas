/**
 * get_definition — go to definition, resolved through re-exports.
 * get_references — find all references (type-aware).
 */

import { URI } from "vscode-uri";
import * as path from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  DocumentHighlight,
  Location,
  Range,
} from "vscode-languageserver-protocol";
import { explainFailure } from "../failure.js";
import {
  dedupeSemanticLocations,
  excludeSemanticLocations,
  formatSemanticLocation,
} from "./semantic-locations.js";

const DEFAULT_REFERENCE_SUMMARY_MAX_FILES = 20;
const DEFAULT_REFERENCE_SUMMARY_MAX_REFERENCES_PER_FILE = 5;

export interface ReferenceSummaryOccurrence {
  line: number;
  col: number;
  text: string;
}

export interface ReferenceSummaryFile {
  file: string;
  count: number;
  references: ReferenceSummaryOccurrence[];
  omittedCount: number;
}

export interface ReferenceSummarySnapshot {
  text: string;
  totalReferences: number;
  totalFiles: number;
  files: ReferenceSummaryFile[];
  omittedFiles: number;
}

export async function getDefinition(
  session: DiagnosticsSession,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };

  const locations = await session.getFileDefinition(absPath, position);
  if (!locations || locations.length === 0) {
    return explainFailure("get_definition", args.file, session, {
      position: `${args.line}:${args.col}`,
    });
  }

  const results = locations.map((loc) => {
    const targetUri = "targetUri" in loc ? loc.targetUri : loc.uri;
    const targetRange = "targetRange" in loc ? loc.targetRange : loc.range;
    const targetPath = path.relative(session.rootDir, URI.parse(targetUri).fsPath);
    const line = targetRange.start.line + 1;
    const col = targetRange.start.character + 1;
    return `${targetPath}:${line}:${col}`;
  });

  return results.join("\n");
}

export async function getReferences(
  session: DiagnosticsSession,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };

  const locations = await session.getFileReferences(absPath, position);
  if (!locations || locations.length === 0) {
    return explainFailure("get_references", args.file, session, {
      position: `${args.line}:${args.col}`,
    });
  }

  const results = locations.map((loc) => {
    const refPath = path.relative(session.rootDir, URI.parse(loc.uri).fsPath);
    const line = loc.range.start.line + 1;
    const col = loc.range.start.character + 1;
    return `${refPath}:${line}:${col}`;
  });

  return `${results.length} references:\n${results.join("\n")}`;
}

function clampReferenceSummaryValue(
  value: number | undefined,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function dedupeReferenceLocations(locations: Location[]): Location[] {
  const seen = new Set<string>();
  const deduped: Location[] = [];

  for (const location of locations) {
    const key = [
      location.uri,
      location.range.start.line,
      location.range.start.character,
      location.range.end.line,
      location.range.end.character,
    ].join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(location);
  }

  return deduped;
}

function formatReferenceExcerpt(sourceLine: string | undefined): string {
  const compactLine = (sourceLine ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (!compactLine) {
    return "(source unavailable)";
  }

  return compactLine.length > 120
    ? `${compactLine.slice(0, 117)}...`
    : compactLine;
}

export async function getReferenceSummary(
  session: DiagnosticsSession,
  args: {
    file: string;
    line: number;
    col: number;
    maxFiles?: number;
    maxReferencesPerFile?: number;
  },
): Promise<ReferenceSummarySnapshot> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };
  const maxFiles = clampReferenceSummaryValue(
    args.maxFiles ?? DEFAULT_REFERENCE_SUMMARY_MAX_FILES,
    1,
    100,
  );
  const maxReferencesPerFile = clampReferenceSummaryValue(
    args.maxReferencesPerFile ?? DEFAULT_REFERENCE_SUMMARY_MAX_REFERENCES_PER_FILE,
    1,
    20,
  );

  const locations = dedupeReferenceLocations(
    await session.getFileReferences(absPath, position),
  );

  if (locations.length === 0) {
    return {
      text: await explainFailure("get_reference_summary", args.file, session, {
        position: `${args.line}:${args.col}`,
      }),
      totalReferences: 0,
      totalFiles: 0,
      files: [],
      omittedFiles: 0,
    };
  }

  const locationsByFile = new Map<string, Location[]>();
  for (const location of locations) {
    const refPath = path.relative(session.rootDir, URI.parse(location.uri).fsPath);
    const existing = locationsByFile.get(refPath) ?? [];
    existing.push(location);
    locationsByFile.set(refPath, existing);
  }

  const fileSummaries = await Promise.all(
    [...locationsByFile.entries()].map(async ([file, fileLocations]) => {
      const sortedLocations = [...fileLocations].sort((left, right) => {
        if (left.range.start.line !== right.range.start.line) {
          return left.range.start.line - right.range.start.line;
        }
        return left.range.start.character - right.range.start.character;
      });
      const absFilePath = URI.parse(sortedLocations[0]?.uri ?? "").fsPath;
      const fileContents = (await session.getFileContent(absFilePath)).split(/\r?\n/);
      const references = sortedLocations
        .slice(0, maxReferencesPerFile)
        .map((location) => ({
          line: location.range.start.line + 1,
          col: location.range.start.character + 1,
          text: formatReferenceExcerpt(fileContents[location.range.start.line]),
        }));

      return {
        file,
        count: sortedLocations.length,
        references,
        omittedCount: Math.max(0, sortedLocations.length - references.length),
      } satisfies ReferenceSummaryFile;
    }),
  );

  const sortedFiles = fileSummaries.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return left.file.localeCompare(right.file);
  });
  const visibleFiles = sortedFiles.slice(0, maxFiles);
  const omittedFiles = Math.max(0, sortedFiles.length - visibleFiles.length);

  const lines = [
    `${locations.length} references across ${sortedFiles.length} files:`,
  ];

  for (const summary of visibleFiles) {
    lines.push(`${summary.file} (${summary.count})`);
    for (const reference of summary.references) {
      lines.push(`  ${reference.line}:${reference.col}  ${reference.text}`);
    }
    if (summary.omittedCount > 0) {
      lines.push(`  … ${summary.omittedCount} more references omitted`);
    }
  }

  if (omittedFiles > 0) {
    lines.push(`… ${omittedFiles} more files omitted`);
  }

  return {
    text: lines.join("\n"),
    totalReferences: locations.length,
    totalFiles: sortedFiles.length,
    files: visibleFiles,
    omittedFiles,
  };
}

function formatCallHierarchyItem(
  rootDir: string,
  item: CallHierarchyItem,
): string {
  const targetPath = path.relative(rootDir, URI.parse(item.uri).fsPath);
  const line = item.selectionRange.start.line + 1;
  const col = item.selectionRange.start.character + 1;
  return `${item.name} — ${targetPath}:${line}:${col}`;
}

function formatCallRanges(ranges: Range[]): string {
  return ranges
    .map((range) => `${range.start.line + 1}:${range.start.character + 1}`)
    .join(", ");
}

export async function getTypeDefinition(
  session: DiagnosticsSession,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };

  const locations = await session.getFileTypeDefinition(absPath, position);
  if (!locations || locations.length === 0) {
    return explainFailure("get_type_definition", args.file, session, {
      position: `${args.line}:${args.col}`,
    });
  }

  return dedupeSemanticLocations(locations)
    .map((location) => formatSemanticLocation(session.rootDir, location))
    .join("\n");
}

export async function getImplementations(
  session: DiagnosticsSession,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };

  const [definitions, locations] = await Promise.all([
    session.getFileDefinition(absPath, position),
    session.getFileImplementations(absPath, position),
  ]);
  if (!locations || locations.length === 0) {
    return explainFailure("get_implementations", args.file, session, {
      position: `${args.line}:${args.col}`,
    });
  }

  const distinctLocations = excludeSemanticLocations(locations, definitions);
  if (distinctLocations.length === 0) {
    return [
      `No distinct implementations found for ${args.file}:${args.line}:${args.col}`,
      "",
      "The language server resolved the symbol's own definition.",
      "Try an interface, abstract member, or provider contract.",
    ].join("\n");
  }

  const results = distinctLocations.map((location) =>
    formatSemanticLocation(session.rootDir, location),
  );
  return `${results.length} implementations:\n${results.join("\n")}`;
}

export async function getDocumentHighlights(
  session: DiagnosticsSession,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };
  const highlights = await session.getFileDocumentHighlights(absPath, position);
  if (!highlights || highlights.length === 0) {
    return explainFailure("get_document_highlights", args.file, session, {
      position: `${args.line}:${args.col}`,
    });
  }

  const lines = highlights.map((highlight: DocumentHighlight) => {
    const start = `${highlight.range.start.line + 1}:${highlight.range.start.character + 1}`;
    const end = `${highlight.range.end.line + 1}:${highlight.range.end.character + 1}`;
    return `${start}-${end}${highlight.kind ? ` (kind ${highlight.kind})` : ""}`;
  });
  return `${lines.length} highlights:\n${lines.join("\n")}`;
}

export async function getFileReferencesForDocument(
  session: DiagnosticsSession,
  args: { file: string; maxResults?: number },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const maxResults = Math.max(1, Math.min(args.maxResults ?? 50, 200));
  const locations = await session.getFileImportReferences(absPath);
  if (!locations || locations.length === 0) {
    return `No file references found for ${args.file}`;
  }

  const lines = locations
    .slice(0, maxResults)
    .map((location) => {
      const refPath = path.relative(session.rootDir, URI.parse(location.uri).fsPath);
      const line = location.range.start.line + 1;
      const col = location.range.start.character + 1;
      return `${refPath}:${line}:${col}`;
    });
  const summary = `${locations.length} file references:\n${lines.join("\n")}`;
  return locations.length > maxResults
    ? `${summary}\n… ${locations.length - maxResults} more references omitted`
    : summary;
}

function formatIncomingCall(
  rootDir: string,
  call: CallHierarchyIncomingCall,
): string {
  const from = formatCallHierarchyItem(rootDir, call.from);
  return `- ${from}${call.fromRanges.length ? ` (from ${formatCallRanges(call.fromRanges)})` : ""}`;
}

function formatOutgoingCall(
  rootDir: string,
  call: CallHierarchyOutgoingCall,
): string {
  const to = formatCallHierarchyItem(rootDir, call.to);
  return `- ${to}${call.fromRanges.length ? ` (from ${formatCallRanges(call.fromRanges)})` : ""}`;
}

export async function getCallHierarchy(
  session: DiagnosticsSession,
  args: {
    file: string;
    line: number;
    col: number;
    maxIncoming?: number;
    maxOutgoing?: number;
  },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };
  const maxIncoming = Math.max(1, Math.min(args.maxIncoming ?? 20, 100));
  const maxOutgoing = Math.max(1, Math.min(args.maxOutgoing ?? 20, 100));

  const items = await session.getFileCallHierarchyItems(absPath, position);
  if (!items || items.length === 0) {
    return explainFailure("get_call_hierarchy", args.file, session, {
      position: `${args.line}:${args.col}`,
    });
  }

  const sections = await Promise.all(items.map(async (item) => {
    const incoming = await session.getCallHierarchyIncomingCalls(item);
    const outgoing = await session.getCallHierarchyOutgoingCalls(item);

    const incomingLines = incoming.slice(0, maxIncoming).map((call) =>
      formatIncomingCall(session.rootDir, call),
    );
    const outgoingLines = outgoing.slice(0, maxOutgoing).map((call) =>
      formatOutgoingCall(session.rootDir, call),
    );

    const lines = [
      `Call hierarchy for ${formatCallHierarchyItem(session.rootDir, item)}`,
      `Incoming (${incoming.length})`,
      ...(incomingLines.length > 0 ? incomingLines : ["- none"]),
      incoming.length > maxIncoming
        ? `… ${incoming.length - maxIncoming} more incoming calls omitted`
        : undefined,
      `Outgoing (${outgoing.length})`,
      ...(outgoingLines.length > 0 ? outgoingLines : ["- none"]),
      outgoing.length > maxOutgoing
        ? `… ${outgoing.length - maxOutgoing} more outgoing calls omitted`
        : undefined,
    ].filter((line): line is string => Boolean(line));

    return lines.join("\n");
  }));

  return sections.join("\n\n");
}
