import {
  RequestType,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";
import type ts from "typescript";

export const ReadFileRequest = {
  type: new RequestType<
    TextDocumentIdentifier,
    string | null,
    never
  >("codeIntelligence/readFile"),
} as const;

export const ResolveDependencySourceRequest = {
  type: new RequestType<
    {
      readonly textDocument: TextDocumentIdentifier;
      readonly moduleName: string;
    },
    ts.ResolvedModuleFull | null,
    never
  >("codeIntelligence/resolveDependencySource"),
} as const;
