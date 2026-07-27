import type { McpServer } from "@modelcontextprotocol/server";
import {
  CodeActionKind,
  CodeActionRequest,
  CodeActionResolveRequest,
  CodeActionTriggerKind,
  type CodeAction,
  Command,
  DocumentDiagnosticRequest,
  DocumentFormattingRequest,
  Range,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import type { VolarWorkspace, VolarWorkspacePool } from "@typeatlas/core";
import { diagnosticIntersects } from "@typeatlas/core/text";
import { type } from "arktype";
import { formatPatchResult } from "./edit-result.ts";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { observedFileInput, rangeInput } from "./tool-input.ts";
import { renderWorkspaceEdit } from "./workspace-edit.ts";
import { type DiagnosticMode, formatDiagnosticMode } from "./ambient-diagnostics.ts";

const formattingInput = {
  "tabSize?": type("number.integer >= 1").configure({
    default: 2,
    description: "Indentation width used by TypeScript code actions.",
  }),
  "insertSpaces?": type("boolean").configure({
    default: true,
    description: "Use spaces rather than tabs in TypeScript code-action edits.",
  }),
} as const;

const input = type.module({
  Dynamic: type({
    ...observedFileInput,
    ...formattingInput,
    range: rangeInput,
    "only?": type
      .enumerated(
        CodeActionKind.QuickFix,
        CodeActionKind.Refactor,
        CodeActionKind.RefactorExtract,
        CodeActionKind.RefactorInline,
        CodeActionKind.RefactorRewrite,
      )
      .configure({ description: "Restrict discovery to quick fixes or refactors." }),
    "action?": type("number.integer >= 1").configure({
      description: "Resolve the corresponding action number from discovery.",
    }),
    "includeUnavailable?": type("boolean").configure({
      default: false,
      description: "Include actions that the language service marks unavailable.",
    }),
  }).onUndeclaredKey("reject"),
  Source: type({
    ...observedFileInput,
    ...formattingInput,
  }).onUndeclaredKey("reject"),
});

const setFormattingOptions = (
  workspace: VolarWorkspace,
  textDocument: TextDocumentIdentifier,
  options: { readonly tabSize: number; readonly insertSpaces: boolean },
  signal: AbortSignal,
) => workspace.sendRequest(DocumentFormattingRequest.type, { textDocument, options }, signal);

const editorCommandText = (command: { readonly command: string } | undefined) =>
  command ? `Follow-up editor command: ${command.command}` : undefined;

const sourceActions = [
  {
    name: "organize_imports",
    title: "Organize imports",
    description: "Return the TypeScript organize-imports action as a Codex patch.",
    kind: `${CodeActionKind.SourceOrganizeImports}.ts`,
    empty: "Imports are already organized.",
  },
  {
    name: "remove_unused_code",
    title: "Remove unused code",
    description: "Return TypeScript's source-wide unused-code removal as a Codex patch.",
    kind: `${CodeActionKind.Source}.removeUnused.ts`,
    empty: "No unused code.",
  },
  {
    name: "add_missing_imports",
    title: "Add missing imports",
    description: "Return TypeScript's source-wide missing-import fixes as a Codex patch.",
    kind: `${CodeActionKind.Source}.addMissingImports.ts`,
    empty: "No missing imports.",
  },
  {
    name: "fix_all",
    title: "Fix all",
    description: "Return TypeScript's source-wide fix-all action as a Codex patch when applicable.",
    kind: `${CodeActionKind.SourceFixAll}.ts`,
    empty: "No fix-all edits are available.",
  },
] as const;

const runSourceAction = async (
  workspaces: VolarWorkspacePool,
  root: string,
  file: string,
  kind: string,
  options: { readonly tabSize: number; readonly insertSpaces: boolean },
  includeDiagnostics: DiagnosticMode,
  empty: string,
  signal: AbortSignal,
) => {
  const workspace = await workspaces.get(root);
  const textDocument = await workspace.getTextDocument(file);
  const [diagnosticReport, resolved] = await Promise.all([
    workspace.sendRequest(DocumentDiagnosticRequest.type, { textDocument }, signal),
    workspace.runResolverSequence(async () => {
      await setFormattingOptions(workspace, textDocument, options, signal);
      const actions =
        (await workspace.sendRequest(
          CodeActionRequest.type,
          {
            textDocument,
            range: Range.create(0, 0, 0, 0),
            context: {
              diagnostics: [],
              only: [kind],
              triggerKind: CodeActionTriggerKind.Invoked,
            },
          },
          signal,
        )) ?? [];
      const selected = actions.find((action): action is CodeAction => !Command.is(action));
      return !selected || selected.data === undefined
        ? selected
        : workspace.sendRequest(CodeActionResolveRequest.type, selected, signal);
    }, signal),
  ]);
  const diagnosticContext = includeDiagnostics
    ? formatDiagnosticMode(textDocument.uri, diagnosticReport, root, includeDiagnostics)
    : undefined;
  if (!resolved) return appendDiagnosticContext(textResult(empty), diagnosticContext);
  if (resolved.disabled) throw new Error(resolved.disabled.reason);
  if (!resolved.edit) {
    return appendDiagnosticContext(textResult(empty), diagnosticContext);
  }
  return appendDiagnosticContext(
    formatPatchResult(
      resolved.title,
      await renderWorkspaceEdit(workspace, root, resolved.edit),
      editorCommandText(resolved.command),
    ),
    diagnosticContext,
  );
};

export const registerCodeActionTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): void => {
  server.registerTool(
    "code_actions",
    {
      title: "Code actions",
      description:
        "Discover quick fixes and refactors for a range, or resolve a displayed action to a Codex patch. Stable source-wide actions have dedicated tools. The MCP does not modify files.",
      inputSchema: input.Dynamic,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        file,
        range,
        only,
        action,
        tabSize = 2,
        insertSpaces = true,
        includeDiagnostics = true,
        includeUnavailable = false,
      },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      return workspace.runResolverSequence(async () => {
        const textDocument = await workspace.getTextDocument(file);
        const [report] = await Promise.all([
          workspace.sendRequest(DocumentDiagnosticRequest.type, { textDocument }, signal),
          setFormattingOptions(workspace, textDocument, { tabSize, insertSpaces }, signal),
        ]);
        const diagnostics =
          report?.kind === "full"
            ? report.items.filter((diagnostic) => diagnosticIntersects(diagnostic, range))
            : [];
        const diagnosticContext = includeDiagnostics
          ? formatDiagnosticMode(textDocument.uri, report, root, includeDiagnostics, range)
          : undefined;
        const actions =
          (await workspace.sendRequest(
            CodeActionRequest.type,
            {
              textDocument,
              range,
              context: {
                diagnostics,
                ...(only ? { only: [only] } : {}),
                triggerKind: CodeActionTriggerKind.Invoked,
              },
            },
            signal,
          )) ?? [];
        const visibleActions = includeUnavailable
          ? actions
          : actions.filter((item) => Command.is(item) || !item.disabled);
        if (action === undefined) {
          if (!visibleActions.length) {
            const diagnosticCount = diagnostics.length
              ? ` for ${diagnostics.length} ${diagnostics.length === 1 ? "diagnostic" : "diagnostics"}`
              : "";
            const scope =
              only === CodeActionKind.QuickFix
                ? `quick fixes${diagnosticCount}`
                : only?.startsWith(CodeActionKind.Refactor)
                  ? "refactors"
                  : "code actions";
            return appendDiagnosticContext(
              textResult(`No ${scope} in this range.`),
              diagnosticContext,
            );
          }
          return appendDiagnosticContext(
            textResult(
              visibleActions
                .map((item, index) => {
                  const command = Command.is(item);
                  const kind = command ? " [editor command]" : item.kind ? ` [${item.kind}]` : "";
                  const disabled =
                    !command && item.disabled ? ` — unavailable: ${item.disabled.reason}` : "";
                  return `${index + 1}. ${item.title}${kind}${disabled}`;
                })
                .join("\n"),
            ),
            diagnosticContext,
          );
        }
        const selected = visibleActions[action - 1];
        if (!selected) throw new Error(`Code action ${action} is not available.`);
        if (Command.is(selected)) {
          return appendDiagnosticContext(
            textResult(`Editor command: ${selected.command}`),
            diagnosticContext,
          );
        }
        const resolved =
          selected.data === undefined
            ? selected
            : await workspace.sendRequest(CodeActionResolveRequest.type, selected, signal);
        if (resolved.disabled) throw new Error(resolved.disabled.reason);
        if (!resolved.edit) {
          return appendDiagnosticContext(
            textResult(
              resolved.command
                ? `Editor command: ${resolved.command.command}`
                : `${resolved.title} produced no edit.`,
            ),
            diagnosticContext,
          );
        }
        return appendDiagnosticContext(
          formatPatchResult(
            resolved.title,
            await renderWorkspaceEdit(workspace, root, resolved.edit),
            editorCommandText(resolved.command),
          ),
          diagnosticContext,
        );
      }, signal);
    },
  );

  for (const sourceAction of sourceActions) {
    server.registerTool(
      sourceAction.name,
      {
        title: sourceAction.title,
        description: `${sourceAction.description} The MCP does not modify files.`,
        inputSchema: input.Source,
        annotations: readOnlyToolAnnotations,
      },
      (
        { workspace, file, tabSize = 2, insertSpaces = true, includeDiagnostics = true },
        { mcpReq: { signal } },
      ) =>
        runSourceAction(
          workspaces,
          workspace,
          file,
          sourceAction.kind,
          { tabSize, insertSpaces },
          includeDiagnostics,
          sourceAction.empty,
          signal,
        ),
    );
  }
};
