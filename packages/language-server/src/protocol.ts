import {
  type Diagnostic,
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
