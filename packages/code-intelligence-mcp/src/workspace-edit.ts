import { readFile } from "node:fs/promises";
import { structuredPatch, type ParsedDiff } from "diff";
import {
  TextDocumentEdit,
  type TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { workspacePath } from "@featuretype/code-intelligence/text";
import type { VolarWorkspace } from "@featuretype/code-intelligence";

export type FileMove = {
  readonly oldUri: string;
  readonly newUri: string;
};

type FileEdit = {
  readonly uri: string;
  readonly edits: readonly TextEdit[];
};

const textDocumentEdits = (edit: WorkspaceEdit): FileEdit[] => {
  if (edit.documentChanges) {
    return edit.documentChanges.map((change) => {
      if (!TextDocumentEdit.is(change)) {
        throw new Error(
          "The workspace edit contains a file operation that Codex patch rendering does not yet support.",
        );
      }
      return {
        uri: change.textDocument.uri,
        edits: change.edits,
      };
    });
  }
  return Object.entries(edit.changes ?? {}).map(([uri, edits]) => ({
    uri,
    edits,
  }));
};

const sourceLines = (source: string) => {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

const oldHunkLines = (lines: readonly string[]) =>
  lines
    .filter((line) => line[0] !== "+" && line[0] !== "\\")
    .map((line) => line.slice(1));

const firstSequenceIndex = (
  lines: readonly string[],
  sequence: readonly string[],
) => {
  if (!sequence.length) return 0;
  return lines.findIndex((_, index) =>
    sequence.every((line, offset) => lines[index + offset] === line)
  );
};

const isPositionFaithful = (
  source: string,
  patch: ParsedDiff,
) => {
  const lines = sourceLines(source);
  return patch.hunks.every((hunk) =>
    firstSequenceIndex(lines, oldHunkLines(hunk.lines)) ===
      Math.max(0, hunk.oldStart - 1)
  );
};

const positionFaithfulPatch = (source: string, updated: string) => {
  const lineCount = sourceLines(source).length;
  const contexts = [3];
  while (contexts.at(-1)! < lineCount) {
    contexts.push(Math.min(lineCount, contexts.at(-1)! * 2));
  }
  for (const context of contexts) {
    const patch = structuredPatch("", "", source, updated, "", "", {
      context,
    });
    if (isPositionFaithful(source, patch)) return patch;
  }
  throw new Error("The edit cannot be represented by a position-faithful Codex patch.");
};

const patchLines = (patch: ParsedDiff) =>
  patch.hunks.flatMap((hunk) => [
    "@@",
    ...hunk.lines.filter((line) => line[0] !== "\\"),
  ]);

const safePath = (uri: string, workspaceRoot: string) => {
  const file = workspacePath(uri, workspaceRoot);
  if (file.includes("\n") || file.includes("\r")) {
    throw new Error(`File path cannot be represented in a Codex patch: ${uri}`);
  }
  return file;
};

export const renderWorkspaceEdit = async (
  workspace: VolarWorkspace,
  workspaceRoot: string,
  edit: WorkspaceEdit,
  moves: readonly FileMove[] = [],
) => {
  const edits = textDocumentEdits(edit);
  const byUri = new Map(edits.map((entry) => [entry.uri, entry]));
  if (byUri.size !== edits.length) {
    throw new Error("The workspace edit contains repeated document edits.");
  }
  const moveByUri = new Map(moves.map((move) => [move.oldUri, move.newUri]));
  if (moveByUri.size !== moves.length) {
    throw new Error("The workspace edit contains repeated file moves.");
  }
  for (const move of moves) {
    if (!byUri.has(move.oldUri)) {
      byUri.set(move.oldUri, { uri: move.oldUri, edits: [] });
    }
  }
  const rendered = await Promise.all([...byUri.values()].map(async ({ uri, edits }) => {
    const parsed = URI.parse(uri);
    if (parsed.scheme !== "file") {
      throw new Error(`Workspace edit URI is not a file: ${uri}`);
    }
    const textDocument = await workspace.getTextDocument(parsed.fsPath);
    const source = await readFile(new URL(textDocument.uri), "utf8");
    const updated = TextDocument.applyEdits(
      TextDocument.create(textDocument.uri, "typescript", 0, source),
      [...edits],
    );
    const move = moveByUri.get(uri);
    const moveAnchor = move ? sourceLines(source)[0] : undefined;
    if (move && moveAnchor === undefined) {
      throw new Error("Codex patches cannot represent moving an empty file.");
    }
    const lines = source === updated
      ? move
        ? ["@@", ` ${moveAnchor}`]
        : []
      : patchLines(positionFaithfulPatch(source, updated));
    if (!move && !lines.length) return undefined;
    return {
      editCount: edits.length,
      lines: [
        `*** Update File: ${safePath(uri, workspaceRoot)}`,
        ...(move
          ? [`*** Move to: ${safePath(move, workspaceRoot)}`]
          : []),
        ...lines,
      ],
    };
  }));
  const files = rendered.filter((file): file is NonNullable<typeof file> =>
    file !== undefined
  );

  return {
    fileCount: files.length,
    editCount: files.reduce((total, file) => total + file.editCount, 0),
    patch: [
      "*** Begin Patch",
      ...files.flatMap(({ lines }) => lines),
      "*** End Patch",
    ].join("\n"),
  };
};
