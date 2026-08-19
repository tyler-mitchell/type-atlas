import type { McpServer } from "@modelcontextprotocol/server";
import {
  DocumentFormattingRequest,
  GetMatchTsConfigRequest,
  type Range,
  RenameRequest,
  WillRenameFilesRequest,
  WorkspaceChange,
} from "@volar/language-server/protocol.js";
import { isFileInDir } from "@volar/language-server/node.js";
import { type } from "arktype";
import * as path from "pathe";
import { URI } from "vscode-uri";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { displayPath, slash } from "atlascii";
import { textResult } from "./mcp-result.ts";
import { fileInput, positionInput } from "./tool-input.ts";
import {
  createTypeAtlas,
  subjectAtPosition,
  type VolarWorkspace,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { type FileMove, renderWorkspaceEdit } from "./workspace-edit.ts";
import { formatPatchResult } from "./edit-result.ts";
import { registerTool } from "./tool.ts";

const input = type.module({
  RenameSymbol: type({
    ...fileInput,
    position: positionInput,
    newName: type("string >= 1").describe("New identifier for the symbol at that position."),
  }),
  RenameFiles: type({
    workspace: fileInput.workspace,
    files: type({
      from: type("string >= 1").describe("Current workspace-relative or absolute path."),
      to: type("string >= 1").describe("Destination path for the move."),
    })
      .array()
      .atLeastLength(1)
      .configure(
        {
          description:
            "One or more { from, to } file moves applied together, so references are updated across the whole set.",
        },
        "self",
      ),
  }),
  FormatDocument: type({
    ...fileInput,
    "tabSize?": type("number.integer >= 1").configure({
      default: 2,
      description: "Columns per indentation level.",
    }),
    "insertSpaces?": type("boolean").configure({
      default: true,
      description: "Indent with spaces rather than tabs.",
    }),
    "trimTrailingWhitespace?": type("boolean").configure({
      description: "Remove trailing whitespace from every line.",
    }),
    "insertFinalNewline?": type("boolean").configure({
      description: "Ensure the file ends with a newline.",
    }),
    "trimFinalNewlines?": type("boolean").configure({
      description: "Collapse repeated trailing newlines at the end of the file.",
    }),
  }),
});

/** A string literal's last path segment, as an importer writes it. */
const specifierPattern = /(["'])([^"'\r\n]*?)([^"'\r\n/]+)\1/g;

/**
 * Specifier edits for importers the platform's rename walk missed.
 *
 * `getEditsForFileRename` returns nothing for importers the tsgo bridge holds
 * as shell files — `test/references-probe.test.ts` in the language server pins
 * it — and no other affordance produces these edits: the walk has no per-file
 * form, and TypeScript registers no document-link provider for imports. So the
 * importer set comes from the assembled file references, which already answer
 * across every loaded project, and a same-directory rename — the one case a
 * basename swap answers exactly — gets its missing specifier edits here.
 * Anything else missed is named to the caller rather than silently shipped as
 * a patch that breaks its build.
 */
const missedSpecifierEdits = async (input: {
  readonly workspace: VolarWorkspace;
  readonly move: FileMove;
  readonly edited: ReadonlySet<string>;
  readonly signal: AbortSignal;
}) => {
  const from = URI.parse(input.move.oldUri).fsPath;
  const to = URI.parse(input.move.newUri).fsPath;
  const { result } = await createTypeAtlas(input.workspace)
    .fileReferences({ file: from, signal: input.signal })
    .catch(() => ({ result: [] as { readonly uri: string }[] }));
  const importers = [...new Set((result ?? []).map(({ uri }) => uri))].filter(
    (uri) => uri !== input.move.oldUri && !input.edited.has(uri),
  );
  if (importers.length === 0) return { changes: [], missed: [] };
  if (path.dirname(from) !== path.dirname(to)) {
    return { changes: [], missed: importers };
  }
  const oldName = path.basename(from);
  const newName = path.basename(to);
  const bare = (name: string) => name.replace(/\.[cm]?[jt]sx?$/u, "");
  const changes = await Promise.all(
    importers.map(async (uri) => {
      const { source } = await input.workspace.readTextDocumentUri(uri, input.signal);
      const edits = source.split("\n").flatMap((line, index) =>
        [...line.matchAll(specifierPattern)].flatMap((match) => {
          const [, , , segment] = match;
          if (segment !== oldName && segment !== bare(oldName)) return [];
          const start = (match.index ?? 0) + match[0].length - 1 - (segment?.length ?? 0);
          return [
            {
              range: {
                start: { line: index, character: start },
                end: { line: index, character: start + (segment?.length ?? 0) },
              },
              newText: segment === oldName ? newName : bare(newName),
            },
          ];
        }),
      );
      return edits.length
        ? [{ textDocument: { uri, version: null }, edits }]
        : [];
    }),
  );
  const flat = changes.flat();
  const covered = new Set(flat.map(({ textDocument }) => textDocument.uri));
  return { changes: flat, missed: importers.filter((uri) => !covered.has(uri)) };
};

export const registerEditingTools = (server: McpServer, workspaces: VolarWorkspacePool): void => {
  registerTool(
    server,
    "rename_symbol",
    {
      title: "Rename symbol",
      description:
        "Return a Codex patch for a TypeScript-project symbol rename at a source position. The MCP does not modify files.",
      inputSchema: input.RenameSymbol,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position, newName }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const [edit, project, resolved] = await Promise.all([
        workspace.sendRequest(RenameRequest.type, { textDocument, position, newName }, signal),
        workspace.sendRequest(GetMatchTsConfigRequest.type, textDocument, signal),
        // What the position resolved to, from the one subject owner. A rename
        // is applied unread more than any other answer, and a drifted
        // position renames something real — the subject on the first line is
        // what lets a reader catch it.
        subjectAtPosition({ workspace, uri: textDocument.uri, position, signal }).catch(
          () => undefined,
        ),
      ]);
      if (!edit) return textResult("");
      const subjectUri = resolved?.declaredAt.uri;
      const subject = resolved
        ? {
            name: resolved.name,
            file: displayPath(resolved.declaredAt.uri, root),
            at: resolved.declaredAt.selection.start,
          }
        : undefined;
      // Installed code lives under the workspace directory, so containment
      // is the wrong boundary — the first witnessed misfire resolved to a
      // file both inside the root and inside node_modules. Editable means in
      // the workspace and not installed.
      const inside = (uri: string) => {
        const fsPath = URI.parse(uri).fsPath;
        return (
          isFileInDir(fsPath, path.resolve(root)) && !/(^|\/)node_modules\//u.test(slash(fsPath))
        );
      };
      // A subject declared in an installed dependency means the rename would
      // patch installed code — through pnpm's hard links, potentially every
      // project's copy. Refused with the subject named, which is also how a
      // drifted position announces itself: one such position renamed
      // arktype's `description` property across twelve files.
      if (subjectUri && !inside(subjectUri)) {
        return formatPatchResult(
          `Rename to ${newName}`,
          await renderWorkspaceEdit(workspace, root, {}),
          { subject, foreign: true },
        );
      }
      // Defensive: a local subject whose edit set still reaches outside the
      // workspace is trimmed to it, and the exclusion is stated.
      const documentChanges = (edit.documentChanges ?? []).filter((change) =>
        "textDocument" in change ? inside(change.textDocument.uri) : true,
      );
      const changes = edit.changes
        ? Object.fromEntries(Object.entries(edit.changes).filter(([uri]) => inside(uri)))
        : undefined;
      const excluded =
        (edit.documentChanges?.length ?? 0) -
        documentChanges.length +
        (edit.changes ? Object.keys(edit.changes).length - Object.keys(changes ?? {}).length : 0);
      const rendered = await renderWorkspaceEdit(workspace, root, {
        ...edit,
        ...(edit.documentChanges ? { documentChanges } : {}),
        ...(changes ? { changes } : {}),
      });
      return formatPatchResult(`Rename to ${newName}`, rendered, {
        subject,
        scope: {
          kind: "project",
          anchor: project ? displayPath(project.uri, root) : undefined,
        },
        note:
          excluded > 0
            ? `${excluded} ${excluded === 1 ? "file" : "files"} outside this workspace ${excluded === 1 ? "was" : "were"} excluded from the patch.`
            : undefined,
      });
    },
  );

  registerTool(
    server,
    "rename_files",
    {
      title: "Rename files",
      description:
        "Return a Codex patch that moves files and updates affected references. The MCP does not modify files.",
      inputSchema: input.RenameFiles,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, files }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const moves: FileMove[] = await Promise.all(
        files.map(async ({ from, to }) => ({
          oldUri: (await workspace.getTextDocument(from)).uri,
          newUri: workspace.getWorkspaceUri(to),
        })),
      );
      const edit = (await workspace.sendRequest(
        WillRenameFilesRequest.type,
        { files: moves },
        signal,
      )) ?? {};
      const edited = new Set(
        (edit.documentChanges ?? []).flatMap((change) =>
          "textDocument" in change ? [change.textDocument.uri] : [],
        ),
      );
      const assembled = await Promise.all(
        moves.map((move) => missedSpecifierEdits({ workspace, move, edited, signal })),
      );
      const changes = assembled.flatMap(({ changes }) => changes);
      const missed = assembled.flatMap(({ missed }) => missed);
      const combined = changes.length
        ? { ...edit, documentChanges: [...(edit.documentChanges ?? []), ...changes] }
        : edit;
      return formatPatchResult(
        "Rename",
        await renderWorkspaceEdit(workspace, root, combined, moves),
        missed.length
          ? {
              note: `References in ${missed
                .map((uri) => displayPath(uri, root))
                .join(", ")} were not updated — the platform's rename walk missed them and a cross-directory specifier is not assembled here. Update them before applying, or use references to find every site.`,
            }
          : undefined,
      );
    },
  );

  registerTool(
    server,
    "format_document",
    {
      title: "Format document",
      description:
        "Return a Codex patch containing document-formatting edits. The MCP does not modify files.",
      inputSchema: input.FormatDocument,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, tabSize = 2, insertSpaces = true, ...rest },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const edits = await workspace.sendRequest(
        DocumentFormattingRequest.type,
        { textDocument, options: { tabSize, insertSpaces, ...rest } },
        signal,
      );
      if (!edits?.length) return textResult("");
      const change = new WorkspaceChange();
      const textChanges = change.getTextEditChange({
        uri: textDocument.uri,
        version: null,
      });
      for (const edit of edits) textChanges.add(edit);
      return formatPatchResult(
        "Format document",
        await renderWorkspaceEdit(workspace, root, change.edit),
      );
    },
  );
};
