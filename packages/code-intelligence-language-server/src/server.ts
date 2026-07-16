import {
  type Connection,
  createServer,
  createTypeScriptProject,
} from "@volar/language-server/node.js";
import ts from "typescript";
import { create as createTypeScriptServices } from "volar-service-typescript";

/** Registers Volar's standard TypeScript project and services on an LSP connection. */
export const registerLanguageServer = (
  connection: Connection,
): void => {
  const server = createServer(connection);
  let watchedFiles: { dispose(): void } | undefined;

  connection.onInitialize((params) =>
    server.initialize(
      params,
      createTypeScriptProject(ts, undefined, () => ({
        languagePlugins: [],
      })),
      createTypeScriptServices(ts),
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
