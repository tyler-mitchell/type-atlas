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

  connection.onInitialize((params) =>
    server.initialize(
      params,
      createTypeScriptProject(ts, undefined, () => ({
        languagePlugins: [],
      })),
      createTypeScriptServices(ts),
    )
  );
  connection.onInitialized(server.initialized);
  connection.onShutdown(server.shutdown);
};
