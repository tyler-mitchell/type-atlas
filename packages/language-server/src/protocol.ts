import {
  type Diagnostic,
  type Location,
  type Position,
  RequestType,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import type ts from "typescript";
import type { Declaration } from "./workspace-declarations.ts";

export type { Declaration } from "./workspace-declarations.ts";

/** Records a disk change for the native bridge's next overlay collection. */
export const TypeScriptFileChangeRequest = {
  type: new RequestType<string, void, never>("type-atlas/typescriptFileChange"),
} as const;

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
    {
      readonly locations: readonly Location[];
      /** How many projects were asked — what grounds the answer's reach. */
      readonly projects: number;
    },
    never
  >("type-atlas/workspaceReferences"),
} as const;

/**
 * Declarations matching a name, from every TypeScript project loaded here.
 *
 * `workspace/symbol` carries no document, so Volar has nothing to resolve a
 * project from and runs the search against one holding no files — it answered
 * an empty array for every query, for a name declared in a project the same
 * session had already checked. The projects that could hold the answer are the
 * ones this server has built, so this asks each of them, exactly as
 * `type-atlas/workspaceReferences` does for a symbol's uses.
 *
 * A document comes with the request only to name the project to start from; the
 * search itself is by name across all of them.
 */
export const WorkspaceDeclarationsRequest = {
  type: new RequestType<
    {
      readonly textDocument: TextDocumentIdentifier;
      readonly query: string;
    },
    {
      readonly declarations: readonly Declaration[];
      /**
       * How many projects were asked. An empty answer's claim is only as
       * strong as the search behind it, and the count is the observation
       * that grounds it — "nothing matched, in the 3 projects loaded" is a
       * statement a reader can weigh, where a bare nothing is not.
       */
      readonly projects: number;
    },
    never
  >("type-atlas/workspaceDeclarations"),
} as const;

/**
 * Marks a document this server opened to ask a question, not one anyone wrote.
 *
 * Asking what a module exports means opening a file beside the importing one
 * and completing against it. TypeScript keeps what it has seen, so the probe
 * stays in the program — and a later whole-project check reported its
 * half-written line as a problem in the caller's project:
 *
 *   === src/presentation.ts.type-atlas-probe.ts ===
 *   error typescript(1003) 1:48-1:48  Identifier expected.
 *
 * One marker, named here rather than spelled out at each end, because the side
 * that creates these files and the side that must not report them are in
 * different packages and drifted apart once already.
 */
export const probeMarker = ".type-atlas-";

/** Whether a file is this server's own scaffolding rather than a reader's source. */
export const isProbeDocument = (fileName: string) => fileName.includes(probeMarker);

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
