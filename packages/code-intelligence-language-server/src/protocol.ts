import {
  RequestType,
  type TextDocumentIdentifier,
} from "@volar/language-server/protocol.js";

export const ReadFileRequest = {
  type: new RequestType<
    TextDocumentIdentifier,
    string | null,
    never
  >("codeIntelligence/readFile"),
} as const;
