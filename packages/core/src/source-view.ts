import { stat } from "node:fs/promises";
import type { FoldingRange } from "@volar/language-server/protocol.js";
import { URI } from "vscode-uri";
import { foldingAffectsView, sourceLines } from "./folded-source.ts";
import { foldingRanges } from "./syntactic-features.ts";
import type { VolarWorkspace } from "./volar-workspace.ts";

/** The inclusive, one-based window of a file a caller asked to see. */
export type SourceWindow = {
  readonly startLine?: number;
  readonly endLine?: number;
};

/** A file's lines and the folding ranges that apply to them. */
export type SourceView = {
  readonly uri: string;
  readonly lines: readonly string[];
  readonly foldingRanges: readonly FoldingRange[];
};

/**
 * The size past which a file is not read into this process.
 *
 * Reading holds the whole file in memory, and this server holds a TypeScript
 * program per project beside it. A generated bundle or a checked-in dataset is
 * the realistic way to reach this, and losing the server to one is worse than
 * refusing the read.
 */
const maxFileBytes = 16 * 1024 * 1024;

/**
 * Reads one view of one file.
 *
 * Nothing here reaches the language server: the text comes from disk and the
 * folding ranges from a parser over that same text, so a read costs what
 * reading a file costs no matter which project the file belongs to or whether
 * that project has ever been loaded. Ranges are computed only when they would
 * change what is printed, since a short view is rendered whole either way.
 */
export const readSourceView = async (input: {
  readonly workspace: VolarWorkspace;
  readonly file: string;
  readonly window: SourceWindow;
  readonly fold: boolean;
  readonly signal: AbortSignal;
}): Promise<SourceView> => {
  const uri = input.workspace.getWorkspaceUri(input.file);
  const size = await stat(URI.parse(uri).fsPath).then(
    ({ size }) => size,
    () => undefined,
  );
  if (size === undefined) throw new Error(`Source document is unavailable: ${input.file}`);
  if (size > maxFileBytes) {
    throw new Error(
      `${input.file} is ${(size / 1024 / 1024).toFixed(1)} MiB, past the ${maxFileBytes / 1024 / 1024} MiB read limit.`,
    );
  }

  const { source } = await input.workspace.readTextDocumentUri(uri, input.signal);
  // The read is answered from disk either way; this only starts the project
  // behind it, so the first question that needs types does not wait for a
  // program that could have been building all along.
  input.workspace.warmProject(uri);
  const lines = sourceLines(source);
  const { startLine, endLine } = input.window;
  if (startLine !== undefined && startLine > lines.length) {
    throw new Error(
      `${input.file} has ${lines.length} lines; startLine ${startLine} is past the end.`,
    );
  }

  const viewLines = Math.min(endLine ?? lines.length, lines.length) - (startLine ?? 1) + 1;
  const worthFolding = input.fold && foldingAffectsView(viewLines);
  return { uri, lines, foldingRanges: worthFolding ? foldingRanges({ uri, source }) : [] };
};
