import {
  type Diagnostic,
  type Location,
  type Position,
  RequestType,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import type ts from "typescript";

/** One project's whole-program diagnostics. */
export type ProjectDiagnostics = {
  readonly configFile: string | null;
  readonly fileCount: number;
  readonly documents: readonly {
    readonly uri: string;
    readonly diagnostics: readonly Diagnostic[];
  }[];
};

/**
 * Checks whole TypeScript projects.
 *
 * Documents select the projects owning them, and Volar resolves each to the
 * service that owns it — so several files in one project resolve to one
 * service and it is checked once. Without documents, every project the server
 * has already loaded answers. Either way a caller asking "what is broken in
 * what I touched" sends one request, not one per file.
 */
export const ProjectDiagnosticsRequest = {
  type: new RequestType<
    { readonly textDocuments?: readonly TextDocumentIdentifier[] },
    readonly ProjectDiagnostics[],
    never
  >("type-atlas/projectDiagnostics"),
} as const;

/**
 * References to a symbol from every TypeScript project loaded in this session.
 *
 * `textDocument/references` answers from the one project owning the file, which
 * is the whole answer only when nothing outside it imports the symbol. Volar
 * exposes no workspace-scoped variant, and the projects that could hold the rest
 * are the ones this server has already built, so this asks each of them and
 * merges. The answer is bounded by what the session has opened, which is why the
 * caller labels it as loaded projects rather than the workspace.
 */
export const WorkspaceReferencesRequest = {
  type: new RequestType<
    {
      readonly textDocument: TextDocumentIdentifier;
      readonly position: Position;
      readonly context: { readonly includeDeclaration: boolean };
    },
    readonly Location[],
    never
  >("type-atlas/workspaceReferences"),
} as const;

/** Resolves an installed module from the TypeScript project containing a document. */
export const ResolveDependencySourceRequest = {
  type: new RequestType<
    {
      readonly textDocument: TextDocumentIdentifier;
      readonly moduleName: string;
    },
    ts.ResolvedModuleFull | null,
    never
  >("type-atlas/resolveDependencySource"),
} as const;
