import {
  createConnection,
  createServer,
  createTypeScriptProject,
  loadTsdkByPath,
} from "@volar/language-server/node.js";
import { create as createTypeScriptServices } from "volar-service-typescript";
import {
  createFeatureTypeServicePlugin,
  featureTypeLanguagePlugin,
} from "@featuretype/service";

const connection = createConnection();
const server = createServer(connection);

connection.onInitialize((params) => {
  const tsdkPath = params.initializationOptions?.typescript?.tsdk;
  if (typeof tsdkPath !== "string") {
    throw new Error("Missing initialization option typescript.tsdk");
  }

  const tsdk = loadTsdkByPath(tsdkPath, params.locale);

  return server.initialize(
    params,
    createTypeScriptProject(tsdk.typescript, tsdk.diagnosticMessages, () => ({
      languagePlugins: [featureTypeLanguagePlugin],
    })),
    [
      ...createTypeScriptServices(tsdk.typescript),
      createFeatureTypeServicePlugin(),
    ],
  );
});

connection.onInitialized(() => {
  server.initialized();
  server.fileWatcher.watchFiles(["**/*.{featuretype,ts,tsx,js,jsx,json}"]);
});

connection.onShutdown(server.shutdown);
connection.listen();
