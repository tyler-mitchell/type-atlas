import { RequestType, type TextDocumentIdentifier } from "@volar/language-server/protocol.js";
import type ts from "typescript";

/** Reads the current server-side text for a document URI. */
export const ReadFileRequest = {
  type: new RequestType<TextDocumentIdentifier, string | null, never>("typeatlas/readFile"),
} as const;

/** Returns the current server-side byte sizes for document URIs. */
export const FileSizesRequest = {
  type: new RequestType<{ readonly uris: readonly string[] }, readonly (number | null)[], never>(
    "typeatlas/fileSizes",
  ),
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
  >("typeatlas/resolveDependencySource"),
} as const;
