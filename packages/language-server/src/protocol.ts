import {
  type Diagnostic,
  RequestType,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import type ts from "typescript";

/** Reads the current server-side text for a document URI. */
export const ReadFileRequest = {
  type: new RequestType<TextDocumentIdentifier, string | null, never>("type-atlas/readFile"),
} as const;

/** Returns the current server-side byte sizes for document URIs. */
export const FileSizesRequest = {
  type: new RequestType<{ readonly uris: readonly string[] }, readonly (number | null)[], never>(
    "type-atlas/fileSizes",
  ),
} as const;

/** Returns diagnostics for the TypeScript project selected by a document. */
export const ProjectDiagnosticsRequest = {
  type: new RequestType<
    TextDocumentIdentifier,
    {
      readonly configFile: string | null;
      readonly fileCount: number;
      readonly documents: readonly {
        readonly uri: string;
        readonly diagnostics: readonly Diagnostic[];
      }[];
    } | null,
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
