import {
  type Connection,
  type LanguagePlugin,
  type LanguageServer,
  createSimpleProject,
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
import { withReferencesAtPosition } from "./references-at-position.ts";
import { createRoutedProject } from "./routed-project.ts";
import {
  isProbeDocument,
  type ProjectDiagnostics,
  ProjectDiagnosticsRequest,
  ResolveDependencySourceRequest,
  TypeScriptFileChangeRequest,
  WorkspaceDeclarationsRequest,
  WorkspaceReferencesRequest,
} from "./protocol.ts";
import { workspaceDeclarations } from "./workspace-declarations.ts";

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

const documentLanguageIds: Readonly<Record<string, string>> = {
  json: "json",
  jsonc: "jsonc",
  ...Object.fromEntries(markdownFileExtensions.map((extension) => [extension, "markdown"])),
};

const documentLanguagePlugin = {
  getLanguageId: ({ path }) =>
    documentLanguageIds[path.slice(path.lastIndexOf(".") + 1).toLowerCase()],
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
  // Not the probes this server opened to ask its own questions. TypeScript
  // retains them, so a whole-project check found their half-written lines and
  // reported them as problems in the caller's project.
  const sourceFiles = program
    .getSourceFiles()
    .filter((file) => !file.isDeclarationFile && !isProbeDocument(file.fileName));
  const byFile = new Map<string, Diagnostic[]>();
  // One file at a time, appending in place. Collecting every diagnostic in the
  // program into a single array before reading any of it held the whole report
  // in memory at once, and rebuilding each file's array per diagnostic —
  // `[...(byFile.get(uri) ?? []), converted]` — copied it again for every entry:
  // quadratic in one file's count. `packages/core-time` reports 774 diagnostics
  // of a single code and the request never returned; `apps/ardy` reports 1,101
  // across 266 files and took 29 seconds.
  for (const file of sourceFiles) {
    for (const diagnostic of [
      ...program.getSyntacticDiagnostics(file, compilerToken),
      ...program.getSemanticDiagnostics(file, compilerToken),
    ]) {
      if (diagnostic.start === undefined || diagnostic.file === undefined) continue;
      const uri = documentUri(diagnostic.file.fileName);
      if (!uri) continue;
      const converted = convertProgramDiagnostic(diagnostic, diagnostic.file, diagnostic.start);
      const held = byFile.get(uri);
      if (held) held.push(converted);
      else byFile.set(uri, [converted]);
    }
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
    connection.onRequest(
      WorkspaceReferencesRequest.type,
      async ({ textDocument, position, context, projectDocuments }, token) => {
        const uri = URI.parse(textDocument.uri);
        projectDocuments?.forEach(({ uri }) => server.project.getLanguageService(URI.parse(uri)));
        const owner = await server.project.getLanguageService(uri);
        const loaded =
          (await Promise.resolve(server.project.getExistingLanguageServices()).catch(
            () => undefined,
          )) ?? [];
        const services = [owner, ...loaded.filter((service) => service !== owner)].filter(
          (service) => {
            if (service === owner) return true;
            try {
              return (
                service.context
                  .inject<TypeScriptService, "typescript/languageService">(
                    "typescript/languageService",
                  )
                  ?.getProgram()
                  ?.getSourceFile(uri.fsPath) !== undefined
              );
            } catch {
              return false;
            }
          },
        );
        const found = await Promise.all(
          services.map((service) =>
            Promise.resolve(service.getReferences(uri, position, context, token)).catch(
              () => undefined,
            ),
          ),
        );
        // Two services answering about the same symbol report the same site, so
        // the merged answer is deduplicated on what a location is: its file and
        // its span. Probe documents are dropped first: TypeScript retains
        // closed probes in the program, their sites are no reader's source,
        // and one leaked into a rendered file_references answer as a phantom
        // file (caught by the determinism gate, seed 2042533537).
        return {
          locations: found
            .flatMap((locations) => locations ?? [])
            .filter((location) => !isProbeDocument(location.uri))
            .filter(
              (location, index, all) =>
                all.findIndex(
                  (other) =>
                    other.uri === location.uri &&
                    other.range.start.line === location.range.start.line &&
                    other.range.start.character === location.range.start.character &&
                    other.range.end.line === location.range.end.line &&
                    other.range.end.character === location.range.end.character,
                ) === index,
            ),
          projects: services.length,
        };
      },
    );
    connection.onRequest(WorkspaceDeclarationsRequest.type, async ({ textDocument, query }) => {
      const uri = URI.parse(textDocument.uri);
      const owner = await server.project.getLanguageService(uri);
      const loaded =
        (await Promise.resolve(server.project.getExistingLanguageServices()).catch(
          () => undefined,
        )) ?? [];
      // One project that cannot answer must not delete what the others found,
      // the same reason `workspaceReferences` catches per service.
      const found = [owner, ...loaded.filter((service) => service !== owner)].flatMap((service) => {
        try {
          return workspaceDeclarations(service, query);
        } catch {
          return [];
        }
      });
      // A declaration reached through two projects is one declaration: the same
      // name at the same place.
      return {
        declarations: found.filter(
          (symbol, index, all) =>
            all.findIndex(
              (other) =>
                other.name === symbol.name &&
                other.location.uri === symbol.location.uri &&
                other.location.range.start.line === symbol.location.range.start.line &&
                other.location.range.start.character === symbol.location.range.start.character,
            ) === index,
        ),
        projects: new Set([owner, ...loaded]).size,
      };
    });
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
      // A project the checker cannot hold must not delete the answer the other
      // projects have. Volar keeps an inferred project for a root with no
      // configuration of its own — a monorepo root, or a package opened while a
      // parent root was already served — and asking it for a program raises
      // `project not found for <root>/jsconfig.json`, which ended the request
      // for every project rather than the one that could not answer.
      return services.flatMap((service) => {
        try {
          return projectDiagnostics(service, token) ?? [];
        } catch {
          return [];
        }
      });
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

  connection.onInitialize((params) => {
    const scripts = createTypeScriptProject(projectTypeScript, undefined, () => ({
      languagePlugins: [],
    }));
    return server.initialize(
      params,
      createRoutedProject(
        scripts,
        createSimpleProject([documentLanguagePlugin]),
        (uri) => documentLanguagePlugin.getLanguageId(uri) !== undefined,
      ),
      withReferencesAtPosition([
        // typescript-auto-import-cache crashes the native bridge when a new
        // source file first enters a project; the stock service stays valid.
        ...createTypeScriptServices(projectTypeScript, { disableAutoImportCache: true }),
        createJsonService(),
        createMarkdownService({
          fileExtensions: [...markdownFileExtensions],
        }),
      ]),
    );
  });
  connection.onRequest(TypeScriptFileChangeRequest.type, (uri) => {
    ts.tnbNoteExternalFileChange(URI.parse(uri).fsPath);
  });
  connection.onInitialized(async () => {
    server.initialized();
    // Volar exposes `watchFiles` and never calls it: no feature in
    // `@volar/language-server` or any `volar-service-*` invokes it, and both the
    // `workspace/didChangeWatchedFiles` listener and its dynamic registration
    // live inside that one function. Until an embedder calls it the server never
    // listens for file changes, so `features/fileSystem.js` keeps every file it
    // has read and `project/typescriptProjectLs.js` never advances its project
    // version — every answer describes the contents a file had when it was first
    // opened. This is the call that makes the watcher real.
    watchedFiles = await server.fileWatcher.watchFiles(["**/*"]);
  });
  connection.onShutdown(() => {
    watchedFiles?.dispose();
    server.shutdown();
  });
};
