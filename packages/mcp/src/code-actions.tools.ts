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
import type { VolarWorkspace, VolarWorkspacePool } from "@type-atlas/core";
import { containsPosition, rangeText, displayPath } from "atlascii";
import { type } from "arktype";
import { renderDocument } from "@type-atlas/core";
import { formatPatchResult } from "./edit-result.ts";
import { appendDiagnosticContext } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { registerTool } from "./tool.ts";
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
    range: rangeInput.configure({
      description:
        "Source range for action discovery. For refactors, prefer a zero-length cursor at the target expression unless the action requires a selection.",
    }),
    "only?": type
      .enumerated(
        CodeActionKind.QuickFix,
        CodeActionKind.Refactor,
        CodeActionKind.RefactorExtract,
        CodeActionKind.RefactorInline,
        CodeActionKind.RefactorRewrite,
      )
      .configure({ description: "Restrict discovery to quick fixes or refactors." }, "self"),
    "action?": type("number.integer >= 1").configure({
      description: "Resolve the corresponding action number from discovery.",
    }),
    "includeUnavailable?": type("boolean").configure({
      default: false,
      description: "Include actions that the language service marks unavailable.",
    }),
  }),
  Source: type({
    ...observedFileInput,
    ...formattingInput,
  }),
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
    // "No missing imports" over unresolved names is an absence lie. The
    // engine can decline to offer import fixes (the current bridge offers
    // declaration fixes but none of the fixMissingImport family); when names
    // do not resolve, the honest empty says so instead of "all clear".
    emptyDespiteProblems: (count: number) =>
      `The language service offered no import fixes, although ${count} ${
        count === 1 ? "name" : "names"
      } in this file ${count === 1 ? "does" : "do"} not resolve. If an import should exist for them, write it by hand — the engine proposed none.`,
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
  action: (typeof sourceActions)[number],
  options: { readonly tabSize: number; readonly insertSpaces: boolean },
  includeDiagnostics: DiagnosticMode,
  signal: AbortSignal,
) => {
  const { kind } = action;
  const workspace = await workspaces.get(root);
  const textDocument = await workspace.getTextDocument(file);
  const diagnosticReportRequest = workspace.sendRequest(
    DocumentDiagnosticRequest.type,
    { textDocument },
    signal,
  );
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
  const resolved =
    !selected || selected.data === undefined
      ? selected
      : await workspace.sendRequest(CodeActionResolveRequest.type, selected, signal);
  const diagnosticReport = await diagnosticReportRequest;
  const diagnosticContext =
    includeDiagnostics === "off"
      ? undefined
      : await formatDiagnosticMode({
          uri: textDocument.uri,
          report: diagnosticReport,
          workspaceRoot: root,
          mode: includeDiagnostics,
        });
  // Unresolved names in the file the action just declined to fix: the empty
  // sentence must not read as "all clear" while they stand.
  const unresolvedNames =
    "emptyDespiteProblems" in action && diagnosticReport && "items" in diagnosticReport
      ? diagnosticReport.items.filter(({ code }) => code === 2304 || code === 2552).length
      : 0;
  const empty =
    unresolvedNames > 0 && "emptyDespiteProblems" in action
      ? action.emptyDespiteProblems(unresolvedNames)
      : action.empty;
  if (!resolved) return appendDiagnosticContext(empty, diagnosticContext);
  if (resolved.disabled) throw new Error(resolved.disabled.reason);
  if (!resolved.edit) {
    return appendDiagnosticContext(empty, diagnosticContext);
  }
  return appendDiagnosticContext(
    await formatPatchResult(
      resolved.title,
      await renderWorkspaceEdit(workspace, root, resolved.edit),
      {
        note: editorCommandText(resolved.command),
      },
    ),
    diagnosticContext,
  );
};

export const registerCodeActionTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): void => {
  registerTool(
    server,
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
        includeDiagnostics = "summary",
        includeUnavailable = false,
      },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const [report] = await Promise.all([
        workspace.sendRequest(DocumentDiagnosticRequest.type, { textDocument }, signal),
        setFormattingOptions(workspace, textDocument, { tabSize, insertSpaces }, signal),
      ]);
      const diagnostics =
        report?.kind === "full"
          ? report.items.filter((diagnostic) => containsPosition(diagnostic.range, range.start))
          : [];
      const diagnosticMode = includeDiagnostics ?? "summary";
      const diagnosticContext =
        diagnosticMode === "off"
          ? undefined
          : await formatDiagnosticMode({
              uri: textDocument.uri,
              report,
              workspaceRoot: root,
              mode: diagnosticMode,
              focus: range,
            });
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
        const rendered = await renderDocument({
          document: "code-actions.tool.mdoc",
          variables: {
            actions: visibleActions.map((item, index) => ({
              marker: `${index + 1}.`,
              name: item.title,
              kind: Command.is(item) ? "editor command" : item.kind,
              detail:
                !Command.is(item) && item.disabled
                  ? `unavailable: ${item.disabled.reason}`
                  : undefined,
            })),
            file: displayPath(textDocument.uri, root),
            at: rangeText(range),
            root,
            scope:
              only === CodeActionKind.QuickFix
                ? "quickFix"
                : only?.startsWith(CodeActionKind.Refactor)
                  ? "refactor"
                  : "any",
            diagnosticCount: diagnostics.length,
          },
        });
        return appendDiagnosticContext(rendered.text, diagnosticContext);
      }
      const selected = visibleActions[action - 1];
      if (!selected) throw new Error(`Code action ${action} is not available.`);
      if (Command.is(selected)) {
        return appendDiagnosticContext(`Editor command: ${selected.command}`, diagnosticContext);
      }
      const resolved =
        selected.data === undefined
          ? selected
          : await workspace.sendRequest(CodeActionResolveRequest.type, selected, signal);
      if (resolved.disabled) throw new Error(resolved.disabled.reason);
      if (!resolved.edit) {
        return appendDiagnosticContext(
          resolved.command
            ? `Editor command: ${resolved.command.command}`
            : `${resolved.title} produced no edit.`,
          diagnosticContext,
        );
      }
      return appendDiagnosticContext(
        await formatPatchResult(
          resolved.title,
          await renderWorkspaceEdit(workspace, root, resolved.edit),
          { note: editorCommandText(resolved.command) },
        ),
        diagnosticContext,
      );
    },
  );

  for (const sourceAction of sourceActions) {
    registerTool(
      server,
      sourceAction.name,
      {
        title: sourceAction.title,
        description: `${sourceAction.description} The MCP does not modify files.`,
        inputSchema: input.Source,
        annotations: readOnlyToolAnnotations,
      },
      (
        { workspace, file, tabSize = 2, insertSpaces = true, includeDiagnostics = "summary" },
        { mcpReq: { signal } },
      ) =>
        runSourceAction(
          workspaces,
          workspace,
          file,
          sourceAction,
          { tabSize, insertSpaces },
          includeDiagnostics,
          signal,
        ),
    );
  }
};
