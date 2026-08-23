import type { LanguageServerProject } from "@volar/language-server/node.js";
import type { URI } from "vscode-uri";

/** Keeps document-only services out of TypeScript workspace operations. */
export const createRoutedProject = (
  scripts: LanguageServerProject,
  documents: LanguageServerProject,
  isDocument: (uri: URI) => boolean,
): LanguageServerProject => ({
  setup(server) {
    scripts.setup(server);
    documents.setup(server);
  },
  reload() {
    scripts.reload();
    documents.reload();
  },
  getLanguageService: (uri) => (isDocument(uri) ? documents : scripts).getLanguageService(uri),
  getExistingLanguageServices: () => scripts.getExistingLanguageServices(),
});
