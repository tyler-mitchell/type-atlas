import * as path from "node:path";
import type { DiagnosticsSession } from "@featuretype/language-server";
import { URI } from "vscode-uri";
import {
  Range,
  RenameFile,
  TextDocumentEdit,
  WorkspaceChange,
  type PrepareRenameResult,
  type WorkspaceEdit,
} from "vscode-languageserver-protocol";
import { explainFailure } from "../failure.js";

export interface WorkspaceEditSummary {
  text: string;
  fileCount: number;
  textEditCount: number;
  renameCount: number;
  files: string[];
  edit: WorkspaceEdit | null;
}

function formatRange(range: Range): string {
  const start = `${range.start.line + 1}:${range.start.character + 1}`;
  const end = `${range.end.line + 1}:${range.end.character + 1}`;
  return `${start}-${end}`;
}

function isPrepareRenamePlaceholder(
  value: PrepareRenameResult,
): value is Extract<PrepareRenameResult, { placeholder: string }> {
  return !Range.is(value) && "placeholder" in value;
}

export async function prepareRename(
  session: DiagnosticsSession,
  args: { file: string; line: number; col: number },
): Promise<string> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };
  let result: PrepareRenameResult | null;
  try {
    result = await session.prepareFileRename(absPath, position);
  } catch (error) {
    return `Rename is not available here.\n${error instanceof Error ? error.message : "Unknown rename failure."}`;
  }

  if (!result) {
    return explainFailure("prepare_rename", args.file, session, {
      position: `${args.line}:${args.col}`,
    });
  }

  if ("defaultBehavior" in result) {
    return "Rename is available here using the server's default rename span.";
  }

  if (isPrepareRenamePlaceholder(result)) {
    return `Rename available at ${formatRange(result.range)}\nPlaceholder: ${result.placeholder}`;
  }

  return `Rename available at ${formatRange(result)}`;
}

function summarizeWorkspaceEdit(
  rootDir: string,
  edit: WorkspaceEdit | null,
  heading: string,
): WorkspaceEditSummary {
  if (!edit) {
    return {
      text: `${heading}\nNo edits produced.`,
      fileCount: 0,
      textEditCount: 0,
      renameCount: 0,
      files: [],
      edit: null,
    };
  }

  const fileEditCounts = new Map<string, number>();
  const renameLines: string[] = [];

  if (edit.documentChanges === undefined && edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const relPath = path.relative(rootDir, URI.parse(uri).fsPath);
      fileEditCounts.set(relPath, (fileEditCounts.get(relPath) ?? 0) + edits.length);
    }
  }

  for (const change of edit.documentChanges ?? []) {
    if (RenameFile.is(change)) {
      const oldPath = path.relative(rootDir, URI.parse(change.oldUri).fsPath);
      const newPath = path.relative(rootDir, URI.parse(change.newUri).fsPath);
      renameLines.push(`- ${oldPath} -> ${newPath}`);
      continue;
    }

    if (TextDocumentEdit.is(change)) {
      const relPath = path.relative(rootDir, URI.parse(change.textDocument.uri).fsPath);
      fileEditCounts.set(relPath, (fileEditCounts.get(relPath) ?? 0) + change.edits.length);
    }
  }

  const files = [...fileEditCounts.keys()].sort();
  const textEditCount = [...fileEditCounts.values()].reduce((sum, count) => sum + count, 0);
  const renameCount = renameLines.length;

  const lines = [
    `${heading}`,
    `${files.length} files touched, ${textEditCount} text edits, ${renameCount} file renames`,
    ...files.map((file) => `- ${file} (${fileEditCounts.get(file)} edits)`),
    ...(renameLines.length > 0 ? ["File renames:", ...renameLines] : []),
  ];

  return {
    text: lines.join("\n"),
    fileCount: files.length,
    textEditCount,
    renameCount,
    files,
    edit,
  };
}

export async function getRenameEdits(
  session: DiagnosticsSession,
  args: { file: string; line: number; col: number; newName: string },
  signal?: AbortSignal,
): Promise<WorkspaceEditSummary> {
  const absPath = path.resolve(session.rootDir, args.file);
  const position = { line: args.line - 1, character: args.col - 1 };
  const edit = await session.getFileRenameEdits(absPath, position, args.newName, signal);
  return summarizeWorkspaceEdit(
    session.rootDir,
    edit,
    `Rename edits for ${args.file}:${args.line}:${args.col} -> ${args.newName}`,
  );
}

export async function getFileRenameEdits(
  session: DiagnosticsSession,
  args: { oldFile: string; newFile: string; overwrite?: boolean },
  signal?: AbortSignal,
): Promise<WorkspaceEditSummary> {
  const volarEdit = await session.getWorkspaceFileRenameEdits(
    args.oldFile,
    args.newFile,
    signal,
  );
  const sourceEdit = volarEdit?.documentChanges
    ? volarEdit
    : {
        changeAnnotations: volarEdit?.changeAnnotations,
        documentChanges: [],
      };
  const change = new WorkspaceChange(sourceEdit);
  if (!volarEdit?.documentChanges) {
    for (const [uri, edits] of Object.entries(volarEdit?.changes ?? {})) {
      const document = change.getTextEditChange({ uri, version: null });
      for (const edit of edits) document.add(edit);
    }
  }
  change.renameFile(
    URI.file(path.resolve(session.rootDir, args.oldFile)).toString(),
    URI.file(path.resolve(session.rootDir, args.newFile)).toString(),
    { overwrite: args.overwrite },
  );
  const edit = change.edit;
  return summarizeWorkspaceEdit(
    session.rootDir,
    edit,
    `File rename edits for ${args.oldFile} -> ${args.newFile}`,
  );
}
