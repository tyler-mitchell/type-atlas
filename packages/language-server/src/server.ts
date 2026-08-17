import {
  type Connection,
  type LanguagePlugin,
  type LanguageServer,
  createServer,
  createTypeScriptProject,
} from "@volar/language-server/node.js";
import {
  type CancellationToken,
  type Diagnostic,
  DiagnosticSeverity,
} from "@volar/language-server/protocol.js";
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
  type ProjectDiagnostics,
  ProjectDiagnosticsRequest,
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

/**
 * Renders a compiler diagnostic as the protocol's.
 *
 * `volar-service-typescript` converts these against a `TextDocument` it holds
 * for an open document; a whole-project check reads files the server has never
 * opened, and the source file the compiler already parsed carries the same
 * line information.
 */
const convertProgramDiagnostic = (
  diagnostic: ts.Diagnostic,
  file: ts.SourceFile,
  start: number,
): Diagnostic => {
  const from = file.getLineAndCharacterOfPosition(start);
  const to = file.getLineAndCharacterOfPosition(start + (diagnostic.length ?? 0));
  return {
    range: { start: from, end: to },
    severity:
      diagnostic.category === ts.DiagnosticCategory.Error
        ? DiagnosticSeverity.Error
        : diagnostic.category === ts.DiagnosticCategory.Warning
          ? DiagnosticSeverity.Warning
          : DiagnosticSeverity.Information,
    code: diagnostic.code,
    source: "typescript",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  };
};

/**
 * Checks one project, file by file, over its shared program.
 *
 * This is a knowing deviation from `docs/volar-affordance-evidence.md` § "TypeScript
 * project diagnostics remain document requests", which prescribes Volar's own
 * per-file `getDiagnostics` so every service plugin contributes and Volar owns
 * conversion and virtual-code mapping. That path re-enters the semantic provider
 * for every document with no short-circuit, which is what made a whole-project
 * check unusable here.
 *
 * The deviation is bounded by two facts this repository has established. This
 * server registers no language plugin that generates virtual code, so the
 * authored ranges the program reports need no mapping. And the files a
 * TypeScript project holds are TypeScript, so the Markdown and JSON providers
 * have nothing to contribute to this result — they answer per document, which
 * `diagnostics` on a single file still reaches.
 *
 * What the deviation must not lose is a configured language-service plugin, and
 * a plugin reaches a caller only through `getSemanticDiagnostics(sourceFile)` —
 * asking the program for every file at once takes the undecorated path. Hence
 * per file rather than per program, over one checker.
 *
 * TypeScript checks its own token between files and unwinds by throwing, which
 * is the only thing that stops a check already under way, so the protocol's
 * token — which reports cancellation but cannot raise it — is adapted rather
 * than passed through.
 */
const projectDiagnostics = (
  service: Awaited<ReturnType<LanguageServer["project"]["getLanguageService"]>>,
  token: CancellationToken,
): ProjectDiagnostics | undefined => {
  const host = service.context.inject<TypeScriptService, "typescript/languageServiceHost">(
    "typescript/languageServiceHost",
  );
  const languageService = service.context.inject<TypeScriptService, "typescript/languageService">(
    "typescript/languageService",
  );
  const program = languageService?.getProgram();
  if (!host || !program) return undefined;

  const documentUri = (fileName: string) =>
    service.context
      .inject<TypeScriptService, "typescript/documentUri">("typescript/documentUri", fileName)
      ?.toString();
  const compilerToken: ts.CancellationToken = {
    isCancellationRequested: () => token.isCancellationRequested,
    throwIfCancellationRequested: () => {
      if (token.isCancellationRequested) throw new ts.OperationCanceledException();
    },
  };
  // Per file, not per program. A project may configure a TypeScript language
  // service plugin — this repository's own `@effect/language-service` is one —
  // and its diagnostics reach a caller only through the decorated
  // `getSemanticDiagnostics(sourceFile)`. Asking the program for everything at
  // once takes the undecorated path and silently drops them. The checker is
  // shared across these calls, so this is the same program pass, entered the
  // way the plugin contract requires.
  const sourceFiles = program.getSourceFiles().filter((file) => !file.isDeclarationFile);
  const byFile = new Map<string, Diagnostic[]>();
  for (const diagnostic of sourceFiles.flatMap((file) => [
    ...program.getSyntacticDiagnostics(file, compilerToken),
    ...program.getSemanticDiagnostics(file, compilerToken),
  ])) {
    if (diagnostic.start === undefined || diagnostic.file === undefined) continue;
    const uri = documentUri(diagnostic.file.fileName);
    if (!uri) continue;
    byFile.set(uri, [
      ...(byFile.get(uri) ?? []),
      convertProgramDiagnostic(diagnostic, diagnostic.file, diagnostic.start),
    ]);
  }
  const configFilePath = host.getCompilationSettings().configFilePath;
  return {
    configFile: typeof configFilePath === "string" ? (documentUri(configFilePath) ?? null) : null,
    // What was checked, which is the program — not the project's root files. A
    // root file imports others, and their errors are reported here, so counting
    // roots understates the check that just ran.
    fileCount: program.getSourceFiles().filter((file) => !file.isDeclarationFile).length,
    documents: [...byFile].map(([uri, diagnostics]) => ({ uri, diagnostics })),
  };
};

/** Registers Volar's standard language services on an LSP connection. */
export const registerLanguageServer = (connection: Connection): void => {
  const server = createServer(connection);
  const projectTypeScript = withEffectLanguageService(ts);
  let watchedFiles: { dispose(): void } | undefined;

  server.onInitialize(() => {
    connection.onRequest(ProjectDiagnosticsRequest.type, async ({ textDocuments }, token) => {
      // Volar resolves a document to the service owning it, so files sharing a
      // project resolve to one service and it is checked once. Deduplicating
      // here is object identity; a caller doing it would be matching config
      // paths after paying for every check.
      const owning = await Promise.all(
        (textDocuments ?? []).map(({ uri }) => server.project.getLanguageService(URI.parse(uri))),
      );
      const services = textDocuments?.length
        ? [...new Set(owning)]
        : await server.project.getExistingLanguageServices();
      return services.flatMap((service) => projectDiagnostics(service, token) ?? []);
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

    connection.onReferences(async (params, token) => {
      const uri = URI.parse(params.textDocument.uri);
      const owner = await server.project.getLanguageService(uri);
      if (!(params as typeof params & { crossProject?: boolean }).crossProject)
        return owner.getReferences(uri, params.position, params.context, token);
      const references = await Promise.all(
        (await server.project.getExistingLanguageServices()).map((service) =>
          service.getReferences(uri, params.position, params.context, token),
        ),
      );
      return [
        ...new Map(
          references
            .flatMap((found) => found ?? [])
            .map((location) => [JSON.stringify(location), location]),
        ).values(),
      ];
    });

    watchedFiles = await server.fileWatcher.watchFiles(["**/*"]);
  });
  connection.onShutdown(() => {
    watchedFiles?.dispose();
    server.shutdown();
  });
};
