import {
  type Connection,
  type LanguagePlugin,
  createServer,
  createTypeScriptProject,
} from "@volar/language-server/node.js";
import type { Location } from "@volar/language-server/protocol.js";
import ts from "typescript";
import { URI } from "vscode-uri";
import { create as createJsonService } from "volar-service-json";
// Keep vscode-markdown-languageservice pinned to 0.5.0-alpha.12 in the workspace config.
// volar-service-markdown's prerelease range also accepts incompatible later releases.
import { create as createMarkdownService } from "volar-service-markdown";
import {
  create as createTypeScriptServices,
  type Provide as TypeScriptService,
} from "volar-service-typescript";
import { withEffectLanguageService } from "./effect-language-service.ts";
import {
  FileSizesRequest,
  ProjectDiagnosticsRequest,
  ReadFileRequest,
  ResolveDependencySourceRequest,
} from "./protocol.ts";

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
export const registerLanguageServer = (connection: Connection): void => {
  const server = createServer(connection);
  const projectTypeScript = withEffectLanguageService(ts);
  let watchedFiles: { dispose(): void } | undefined;

  server.onInitialize(() => {
    connection.onRequest(
      ReadFileRequest.type,
      async ({ uri }) => (await server.fileSystem.readFile(URI.parse(uri))) ?? null,
    );
    connection.onRequest(FileSizesRequest.type, ({ uris }) =>
      Promise.all(
        uris.map(async (uri) => (await server.fileSystem.stat(URI.parse(uri)))?.size ?? null),
      ),
    );
    connection.onRequest(ProjectDiagnosticsRequest.type, async (textDocument, token) => {
      const service = await server.project.getLanguageService(URI.parse(textDocument.uri));
      const host = service.context.inject<TypeScriptService, "typescript/languageServiceHost">(
        "typescript/languageServiceHost",
      );
      if (!host) return null;

      const configFilePath = host.getCompilationSettings().configFilePath;
      const fileNames = host.getScriptFileNames();
      const documents = await Promise.all(
        fileNames.map(async (fileName) => {
          const uri = service.context.inject<TypeScriptService, "typescript/documentUri">(
            "typescript/documentUri",
            fileName,
          );
          if (!uri) return null;
          const diagnostics = await service.getDiagnostics(uri, undefined, token);
          return diagnostics.length ? { uri: uri.toString(), diagnostics } : null;
        }),
      );
      return {
        configFile:
          typeof configFilePath === "string"
            ? (service.context
                .inject<TypeScriptService, "typescript/documentUri">(
                  "typescript/documentUri",
                  configFilePath,
                )
                ?.toString() ?? null)
            : null,
        fileCount: fileNames.length,
        documents: documents.filter((document) => document !== null),
      };
    });
    connection.onRequest(
      ResolveDependencySourceRequest.type,
      async ({ textDocument, moduleName }) => {
        const uri = URI.parse(textDocument.uri);
        const service = await server.project.getLanguageService(uri);
        const languageService = service.context.inject<
          TypeScriptService,
          "typescript/languageService"
        >("typescript/languageService");
        const host = service.context.inject<TypeScriptService, "typescript/languageServiceHost">(
          "typescript/languageServiceHost",
        );
        const fileName = service.context.inject<TypeScriptService, "typescript/documentFileName">(
          "typescript/documentFileName",
          uri,
        );
        if (!languageService || !host || !fileName) return null;

        const options = host.getCompilationSettings();
        const mode = languageService.getProgram()?.getSourceFile(fileName)?.impliedNodeFormat;
        const declaration = ts.resolveModuleName(
          moduleName,
          fileName,
          options,
          host,
          host.getModuleResolutionCache?.(),
          undefined,
          mode,
        ).resolvedModule;
        return (
          declaration ??
          ts.resolveModuleName(
            moduleName,
            fileName,
            { ...options, noDtsResolution: true },
            host,
            undefined,
            undefined,
            mode,
          ).resolvedModule ??
          null
        );
      },
    );
  });

  connection.onInitialize((params) =>
    server.initialize(
      params,
      createTypeScriptProject(projectTypeScript, undefined, () => ({
        languagePlugins: [documentLanguagePlugin],
      })),
      [
        ...createTypeScriptServices(projectTypeScript),
        createJsonService(),
        createMarkdownService({
          fileExtensions: [...markdownFileExtensions],
        }),
      ],
    ),
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
