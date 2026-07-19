import {
  createCodeIntelligence,
  createVolarWorkspaces,
  inspectSymbol,
  page,
  projectDocumentSymbols,
} from "@featuretype/code-intelligence";
import { formatFoldedSource } from "@featuretype/code-intelligence/folded-source";
import {
  formatDiagnosticContext,
  formatDiagnostics,
  formatDocumentSymbols,
  formatHover,
  formatLocationPage,
  formatNavigation,
  formatPositionQuery,
  formatWorkspaceSymbolScope,
  formatWorkspaceSymbols,
  workspacePath,
} from "@featuretype/code-intelligence/text";
import { type } from "arktype";
import type {
  SymbolInformation,
  WorkspaceSymbol,
} from "@volar/language-server/protocol.js";
import { input, namespace } from "./schema.ts";

export type TaskContext = {
  readonly root: string;
  readonly changedFiles: readonly string[];
};

const sourceFile = /\.(?:[cm]?[jt]sx?)$/i;

const diagnosticContext = async (
  intelligence: ReturnType<typeof createCodeIntelligence>,
  root: string,
  file: string,
  include: boolean,
  signal: AbortSignal,
  focus?: { readonly line: number; readonly character: number },
) => {
  if (!include) return undefined;
  try {
    const { textDocument, report } = await intelligence.diagnostics(file, signal);
    return formatDiagnosticContext(
      textDocument.uri,
      report,
      root,
      focus,
    );
  } catch {
    return undefined;
  }
};

const withDiagnostics = (text: string, context: string | undefined) =>
  context ? `${text}\n\n${context}` : text;

const validationError = (error: unknown) =>
  error instanceof type.errors ? error.summary : String(error);

export const createDynamicTools = (languageServer: URL) => {
  const workspaces = createVolarWorkspaces(languageServer);

  const call = async (
    context: TaskContext,
    toolName: string,
    argumentsValue: unknown,
    signal: AbortSignal,
  ): Promise<string> => {
    const workspace = await workspaces.get(context.root);
    const intelligence = createCodeIntelligence(workspace);

    switch (toolName) {
      case "inspect_symbol": {
        const request = input.InspectSymbol(argumentsValue);
        if (request instanceof type.errors) throw new Error(validationError(request));
        const result = await inspectSymbol(
          workspace,
          context.root,
          request.file,
          "symbol" in request
            ? { symbol: request.symbol }
            : { position: request.position },
          {
            includeSource: request.includeSource,
            includeTypeDefinitions: request.includeTypeDefinitions,
            limit: request.limit,
          },
          signal,
        );
        return withDiagnostics(
          result.text,
          await diagnosticContext(
            intelligence,
            context.root,
            request.file,
            request.includeDiagnostics,
            signal,
            result.position,
          ),
        );
      }

      case "read_file": {
        const request = input.ReadFile(argumentsValue);
        if (request instanceof type.errors) throw new Error(validationError(request));
        const entries = Array.isArray(request.file) ? request.file : [request.file];
        const sections = await Promise.all(entries.map(async (entry) => {
          const target = typeof entry === "string" ? { path: entry } : entry;
          try {
            const fold = target.fold ?? request.fold;
            const { textDocument, source, foldingRanges } =
              await intelligence.readSource(target.path, fold, signal);
            const contextText = await diagnosticContext(
              intelligence,
              context.root,
              target.path,
              request.includeDiagnostics,
              signal,
            );
            return {
              file: workspacePath(textDocument.uri, context.root),
              text: withDiagnostics(
                formatFoldedSource(source, foldingRanges, target),
                contextText,
              ),
            };
          } catch (error) {
            signal.throwIfAborted();
            if (entries.length === 1) throw error;
            return {
              file: target.path,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }));
        return sections.length === 1
          ? sections[0]?.text ?? ""
          : sections.map(({ file, text }) => `== ${file} ==\n${text}`).join("\n\n");
      }

      case "diagnostics": {
        const request = input.Diagnostics(argumentsValue);
        if (request instanceof type.errors) throw new Error(validationError(request));
        const requested = request.file === undefined
          ? context.changedFiles.filter((file) => sourceFile.test(file))
          : Array.isArray(request.file)
          ? request.file
          : [request.file];
        const reports = await Promise.all(requested.map(async (file) => {
          const { textDocument, report } = await intelligence.diagnostics(file, signal);
          return formatDiagnostics(textDocument.uri, report, context.root);
        }));
        return reports.filter(Boolean).join("\n\n");
      }

      case "document_symbols": {
        const request = input.DocumentSymbols(argumentsValue);
        if (request instanceof type.errors) throw new Error(validationError(request));
        const { textDocument, symbols } = await intelligence.documentSymbols(
          request.file,
          signal,
        );
        const projected = symbols === null
          ? null
          : projectDocumentSymbols(symbols, request.depth);
        return withDiagnostics(
          formatDocumentSymbols(textDocument.uri, projected, context.root),
          await diagnosticContext(
            intelligence,
            context.root,
            request.file,
            request.includeDiagnostics,
            signal,
          ),
        );
      }

      case "hover": {
        const request = input.Position(argumentsValue);
        if (request instanceof type.errors) throw new Error(validationError(request));
        const { textDocument, hover } = await intelligence.hover(
          request.file,
          request.position,
          signal,
        );
        return withDiagnostics(
          formatHover(textDocument.uri, hover, context.root),
          await diagnosticContext(
            intelligence,
            context.root,
            request.file,
            request.includeDiagnostics,
            signal,
            request.position,
          ),
        );
      }

      case "definitions": {
        const request = input.Position(argumentsValue);
        if (request instanceof type.errors) throw new Error(validationError(request));
        const { definitions } = await intelligence.definitions(
          request.file,
          request.position,
          signal,
        );
        return withDiagnostics(
          formatNavigation("definitions", definitions, context.root),
          await diagnosticContext(
            intelligence,
            context.root,
            request.file,
            request.includeDiagnostics,
            signal,
            request.position,
          ),
        );
      }

      case "references": {
        const request = input.References(argumentsValue);
        if (request instanceof type.errors) throw new Error(validationError(request));
        const [referenceResult, hoverResult] = await Promise.all([
          intelligence.references(
            request.file,
            request.position,
            request.includeDeclaration,
            signal,
          ),
          intelligence.hover(request.file, request.position, signal),
        ]);
        const resultPage = referenceResult.references === null
          ? null
          : page(
            referenceResult.references,
            request.offset,
            request.limit,
          );
        return withDiagnostics(
          [
            formatPositionQuery(
              referenceResult.textDocument.uri,
              request.position,
              hoverResult.hover,
              context.root,
            ),
            formatLocationPage("references", resultPage, context.root),
          ].join("\n"),
          await diagnosticContext(
            intelligence,
            context.root,
            request.file,
            request.includeDiagnostics,
            signal,
            request.position,
          ),
        );
      }

      case "workspace_symbols": {
        const request = input.WorkspaceSymbols(argumentsValue);
        if (request instanceof type.errors) throw new Error(validationError(request));
        const { project, symbols } = await intelligence.workspaceSymbols(
          request.file,
          request.query,
          signal,
        );
        return [
          formatWorkspaceSymbolScope(project, context.root),
          formatWorkspaceSymbols(
            symbols === null
              ? null
              : page<SymbolInformation | WorkspaceSymbol>(
                symbols,
                request.offset,
                request.limit,
              ),
            context.root,
          ),
        ].join("\n");
      }

      default:
        throw new Error(`Unknown code intelligence tool: ${toolName}`);
    }
  };

  return { namespace, call, dispose: workspaces.dispose };
};
