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
  LocationLink,
  Range,
} from "vscode-languageserver-protocol";
import { explainFailure } from "../failure.js";

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

function formatLocation(
  rootDir: string,
  location: Location | LocationLink,
): string {
  const targetUri = "targetUri" in location ? location.targetUri : location.uri;
  const targetRange = "targetRange" in location ? location.targetRange : location.range;
  const targetPath = path.relative(rootDir, URI.parse(targetUri).fsPath);
  const line = targetRange.start.line + 1;
  const col = targetRange.start.character + 1;
  return `${targetPath}:${line}:${col}`;
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

  return locations.map((location) => formatLocation(session.rootDir, location)).join("\n");
}

export async function getImplementations(
  session: DiagnosticsSession,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };

  const locations = await session.getFileImplementations(absPath, position);
  if (!locations || locations.length === 0) {
    return explainFailure("get_implementations", args.file, session, {
      position: `${args.line}:${args.col}`,
    });
  }

  const results = locations.map((location) => formatLocation(session.rootDir, location));
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
