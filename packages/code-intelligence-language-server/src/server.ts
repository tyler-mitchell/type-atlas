import {
  type Connection,
  type LanguagePlugin,
  createServer,
  createTypeScriptProject,
} from "@volar/language-server/node.js";
import ts from "typescript";
import { URI } from "vscode-uri";
import { create as createJsonService } from "volar-service-json";
import { create as createMarkdownService } from "volar-service-markdown";
import { create as createTypeScriptServices } from "volar-service-typescript";
import { ReadFileRequest } from "./protocol.ts";

const markdownFileExtensions = [
  "md",
  "mkd",
  "mdwn",
  "mdown",
  "markdown",
  "markdn",
  "mdtxt",
  "mdtext",
  "workbook",
] as const;

const documentLanguagePlugin = {
  getLanguageId: ({ path }) => {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    return extension === "jsonc"
      ? "jsonc"
      : markdownFileExtensions.some((candidate) => candidate === extension)
      ? "markdown"
      : undefined;
  },
} satisfies LanguagePlugin<URI>;

/** Registers Volar's standard language services on an LSP connection. */
export const registerLanguageServer = (
  connection: Connection,
): void => {
  const server = createServer(connection);
  let watchedFiles: { dispose(): void } | undefined;

  server.onInitialize(() => {
    connection.onRequest(ReadFileRequest.type, async ({ uri }) =>
      await server.fileSystem.readFile(URI.parse(uri)) ?? null
    );
  });

  connection.onInitialize((params) =>
    server.initialize(
      params,
      createTypeScriptProject(ts, undefined, () => ({
        languagePlugins: [documentLanguagePlugin],
      })),
      [
        ...createTypeScriptServices(ts),
        createJsonService(),
        createMarkdownService({
          fileExtensions: [...markdownFileExtensions],
        }),
      ],
    )
  );
  connection.onInitialized(async () => {
    server.initialized();
    watchedFiles = await server.fileWatcher.watchFiles(["**/*"]);
  });
  connection.onShutdown(() => {
    watchedFiles?.dispose();
    server.shutdown();
  });
};
