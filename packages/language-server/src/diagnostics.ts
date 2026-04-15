import * as cp from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import {
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  CodeActionRequest,
  CodeActionResolveRequest,
  CompletionRequest,
  CompletionResolveRequest,
  ConfigurationRequest,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentHighlightRequest,
  DocumentDiagnosticReportKind,
  DocumentDiagnosticRequest,
  DocumentSymbolRequest,
  FileChangeType,
  HoverRequest,
  ImplementationRequest,
  InitializeRequest,
  InitializedNotification,
  PrepareRenameRequest,
  ReferencesRequest,
  RenameRequest,
  SignatureHelpRequest,
  SignatureHelpTriggerKind,
  ShutdownRequest,
  TypeDefinitionRequest,
  WillRenameFilesRequest,
  WorkspaceDiagnosticRequest,
  WorkspaceSymbolRequest,
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  type CodeAction,
  type Command,
  type CompletionItem,
  type CompletionList,
  type Diagnostic,
  type DocumentHighlight,
  type DocumentSymbol,
  type Hover,
  type Location,
  type LocationLink,
  type Position,
  type PrepareRenameResult,
  type Range,
  type SignatureHelp,
  type SymbolInformation,
  type WorkspaceEdit,
  type WorkspaceSymbol,
} from "vscode-languageserver-protocol";
import { FindFileReferenceRequest } from "@volar/language-server/protocol.js";
import {
  createProtocolConnection,
  loadTsdkByPath,
} from "@volar/language-server/node.js";
import { URI } from "vscode-uri";
import { requestSignatureHelpWithFallback } from "./signature-help.js";

export interface ResolveWorkspaceTsdkOptions {
  tsdk?: string;
}

export interface CreateFeatureTypeLanguageServerClientOptions
  extends ResolveWorkspaceTsdkOptions {
  rootDir: string;
}

type ProjectDiagnosticBatch = {
  filePath: string;
  diagnostics: Diagnostic[];
};

export interface SyncedDocument {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface FeatureTypeLanguageServerClient {
  rootDir: string;
  tsdk: string;
  openFileFromDisk(filePath: string): Promise<SyncedDocument>;
  refreshFileFromDisk(filePath: string): Promise<SyncedDocument>;
  /**
   * Register a virtual file with the language server using caller-supplied content.
   * The file does not need to exist on disk. Subsequent semantic queries against
   * this path will use the provided content. Calling again with the same path
   * updates the content.
   */
  openVirtualFile(filePath: string, content: string): Promise<SyncedDocument>;
  /**
   * Remove a previously registered virtual file from the language server.
   * No-ops if the path was never opened as virtual.
   */
  closeVirtualFile(filePath: string): Promise<void>;
  /** Returns the set of absolute paths currently registered as virtual. */
  getVirtualFilePaths(): string[];
  /** Returns the in-memory content for a virtual file, or undefined if not virtual. */
  getVirtualFileContent(filePath: string): string | undefined;
  getWorkspaceDiagnostics(): Promise<
    Array<{ filePath: string; diagnostics: Diagnostic[] }> | null
  >;
  getDocumentDiagnostics(filePath: string): Promise<Diagnostic[]>;
  getDocumentCodeActions(
    filePath: string,
    range: Range,
    diagnostics: Diagnostic[],
  ): Promise<Array<CodeAction | Command>>;
  getDocumentCompletions(
    filePath: string,
    position: Position,
  ): Promise<CompletionList>;
  resolveCompletionItem(item: CompletionItem): Promise<CompletionItem>;
  getDocumentHover(
    filePath: string,
    position: Position,
  ): Promise<Hover | null>;
  getDocumentSignatureHelp(
    filePath: string,
    position: Position,
  ): Promise<SignatureHelp | null>;
  getDocumentDefinition(
    filePath: string,
    position: Position,
  ): Promise<Array<Location | LocationLink>>;
  getDocumentReferences(
    filePath: string,
    position: Position,
  ): Promise<Location[]>;
  getDocumentTypeDefinition(
    filePath: string,
    position: Position,
  ): Promise<Array<Location | LocationLink>>;
  getDocumentImplementations(
    filePath: string,
    position: Position,
  ): Promise<Array<Location | LocationLink>>;
  getDocumentHighlights(
    filePath: string,
    position: Position,
  ): Promise<DocumentHighlight[]>;
  getDocumentImportReferences(filePath: string): Promise<Location[]>;
  getWorkspaceSymbols(query: string): Promise<WorkspaceSymbol[]>;
  prepareDocumentRename(
    filePath: string,
    position: Position,
  ): Promise<PrepareRenameResult | null>;
  getDocumentRenameEdits(
    filePath: string,
    position: Position,
    newName: string,
  ): Promise<WorkspaceEdit | null>;
  getDocumentFileRenameEdits(
    oldFilePath: string,
    newFilePath: string,
  ): Promise<WorkspaceEdit | null>;
  getDocumentCallHierarchyItems(
    filePath: string,
    position: Position,
  ): Promise<CallHierarchyItem[]>;
  getCallHierarchyIncomingCalls(
    item: CallHierarchyItem,
  ): Promise<CallHierarchyIncomingCall[]>;
  getCallHierarchyOutgoingCalls(
    item: CallHierarchyItem,
  ): Promise<CallHierarchyOutgoingCall[]>;
  getDocumentSymbols(
    filePath: string,
  ): Promise<Array<DocumentSymbol | SymbolInformation>>;
  notifyWatchedFiles(filePaths: string[]): Promise<void>;
  dispose(): Promise<void>;
}

export interface DiagnosticsSession {
  rootDir: string;
  tsdk: string;
  getProjectFileNames(): Promise<string[]>;
  getWorkspaceDiagnostics(): Promise<Array<{ filePath: string; diagnostics: Diagnostic[] }> | null>;
  /**
   * Register a virtual file with the session using caller-supplied content.
   * The file does not need to exist on disk. It will appear in
   * getProjectFileNames() and accept all semantic queries.
   */
  openVirtualFile(filePath: string, content: string): Promise<void>;
  /** Remove a previously registered virtual file. No-ops if unknown. */
  closeVirtualFile(filePath: string): Promise<void>;
  /** Returns true if the path is currently registered as a virtual file. */
  isVirtualFile(filePath: string): boolean;
  /**
   * Returns the current text content of a file. For virtual files, returns
   * the in-memory content. For disk files, reads from disk.
   * Throws if the file is neither virtual nor readable from disk.
   */
  getFileContent(filePath: string): string;
  getFileDiagnostics(filePath: string): Promise<Diagnostic[]>;
  getFileCodeActions(
    filePath: string,
    range: Range,
    diagnostics: Diagnostic[],
  ): Promise<Array<CodeAction | Command>>;
  getFileCompletions(
    filePath: string,
    position: Position,
  ): Promise<CompletionList>;
  resolveCompletionItem(item: CompletionItem): Promise<CompletionItem>;
  getFileHover(
    filePath: string,
    position: Position,
  ): Promise<Hover | null>;
  getFileSignatureHelp(
    filePath: string,
    position: Position,
  ): Promise<SignatureHelp | null>;
  getFileDefinition(
    filePath: string,
    position: Position,
  ): Promise<Array<Location | LocationLink>>;
  getFileReferences(
    filePath: string,
    position: Position,
  ): Promise<Location[]>;
  getFileTypeDefinition(
    filePath: string,
    position: Position,
  ): Promise<Array<Location | LocationLink>>;
  getFileImplementations(
    filePath: string,
    position: Position,
  ): Promise<Array<Location | LocationLink>>;
  getFileDocumentHighlights(
    filePath: string,
    position: Position,
  ): Promise<DocumentHighlight[]>;
  getFileImportReferences(filePath: string): Promise<Location[]>;
  getWorkspaceSymbols(query: string): Promise<WorkspaceSymbol[]>;
  prepareFileRename(
    filePath: string,
    position: Position,
  ): Promise<PrepareRenameResult | null>;
  getFileRenameEdits(
    filePath: string,
    position: Position,
    newName: string,
  ): Promise<WorkspaceEdit | null>;
  getWorkspaceFileRenameEdits(
    oldFilePath: string,
    newFilePath: string,
  ): Promise<WorkspaceEdit | null>;
  getFileCallHierarchyItems(
    filePath: string,
    position: Position,
  ): Promise<CallHierarchyItem[]>;
  getCallHierarchyIncomingCalls(
    item: CallHierarchyItem,
  ): Promise<CallHierarchyIncomingCall[]>;
  getCallHierarchyOutgoingCalls(
    item: CallHierarchyItem,
  ): Promise<CallHierarchyOutgoingCall[]>;
  getFileDocumentSymbols(
    filePath: string,
  ): Promise<Array<DocumentSymbol | SymbolInformation>>;
  notifyFilesChanged(filePaths: string[]): Promise<void>;
  notifyFileChanged(filePath: string): Promise<void>;
  dispose(): Promise<void>;
}

const languageServerPackageRoot = path.resolve(__dirname, "..");
const distServerModulePath = path.join(languageServerPackageRoot, "dist", "server.js");
const srcServerModulePath = path.join(languageServerPackageRoot, "src", "server.ts");
const requireFromLanguageServerPackage = createRequire(
  path.join(languageServerPackageRoot, "package.json"),
);
const RELATIVE_JS_MODULE_PATTERN = /\b(?:import|export)\b[^'"\n;]*["'](\.[^"'`\n;]+)["']/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["'](\.[^"'`\n]+)["']\s*\)/g;
const NORMALIZABLE_LANGUAGE_IDS = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
const FEATURETYPE_RUNTIME_MODE_ENV = "FEATURETYPE_RUNTIME_MODE";

function getFeatureTypeRuntimeMode(): "auto" | "source" | "dist" {
  const configuredMode = process.env[FEATURETYPE_RUNTIME_MODE_ENV]?.trim().toLowerCase();
  if (configuredMode === "source" || configuredMode === "dist") {
    return configuredMode;
  }
  return "auto";
}

function supportsCodeActionResolve(
  action: CodeAction | Command,
): action is CodeAction & { data: NonNullable<CodeAction["data"]> } {
  return "data" in action && action.data !== undefined && action.data !== null;
}

function normalizeCompletionResult(
  completions: CompletionItem[] | CompletionList | null,
): CompletionList {
  if (!completions) {
    return {
      isIncomplete: false,
      items: [],
    };
  }

  if (Array.isArray(completions)) {
    return {
      isIncomplete: false,
      items: completions,
    };
  }

  return completions;
}

function resolveLanguageServerModule(): { scriptPath: string; execArgv: string[] } {
  const runtimeMode = getFeatureTypeRuntimeMode();
  const shouldPreferSourceModule =
    runtimeMode === "source" ||
    (runtimeMode !== "dist" &&
      ((process.env.VITEST ?? "").length > 0 || process.env.NODE_ENV === "test"));

  if (shouldPreferSourceModule && fs.existsSync(srcServerModulePath)) {
    return {
      scriptPath: srcServerModulePath,
      execArgv: ["--nolazy", "--import", "tsx"],
    };
  }

  if (fs.existsSync(distServerModulePath)) {
    return { scriptPath: distServerModulePath, execArgv: ["--nolazy"] };
  }

  if (!fs.existsSync(srcServerModulePath)) {
    throw new Error(
      "Unable to locate the language server module. Expected dist/server.js or src/server.ts.",
    );
  }

  return {
    scriptPath: srcServerModulePath,
    execArgv: ["--nolazy", "--import", "tsx"],
  };
}

function normalizeVirtualImportSpecifiers(fileContent: string): string {
  return fileContent
    .replace(
      RELATIVE_JS_MODULE_PATTERN,
      (_match, specifier: string) =>
        _match.replace(
          specifier,
          normalizeVirtualImportSpecifier(specifier),
        ),
    )
    .replace(
      DYNAMIC_IMPORT_PATTERN,
      (_match, specifier: string) =>
        _match.replace(
          specifier,
          normalizeVirtualImportSpecifier(specifier),
        ),
    );
}

function normalizeVirtualImportSpecifier(specifier: string): string {
  if (!specifier.startsWith(".")) {
    return specifier;
  }

  const bareSpecifier = specifier.split(/[?#]/)[0];
  if (bareSpecifier.endsWith("/")) {
    return specifier;
  }

  if (path.extname(bareSpecifier)) {
    return specifier;
  }

  return `${specifier}.js`;
}

export function resolveWorkspaceTsdk(
  rootDir: string,
  options: ResolveWorkspaceTsdkOptions = {},
): string {
  const resolvedRoot = path.resolve(rootDir);

  if (options.tsdk) {
    return normalizeTsdkPath(resolvedRoot, options.tsdk);
  }

  const workspaceCandidates = listWorkspaceTsdkCandidates(resolvedRoot);
  const workspaceTsdk = workspaceCandidates.find((candidate) =>
    hasTypeScriptRuntime(candidate)
  );
  if (workspaceTsdk) {
    return workspaceTsdk;
  }

  const bundledTsdk = resolveBundledTsdk();
  if (bundledTsdk) {
    return bundledTsdk;
  }

  throw new Error(
    [
      `Unable to resolve a workspace TypeScript SDK for ${resolvedRoot}.`,
      "Checked:",
      ...workspaceCandidates.map((candidate) => `  ${candidate}`),
      "  typescript/lib/typescript.js from the FeatureType installation",
      "Pass an explicit tsdk path or attach a project root that contains node_modules/typescript/lib.",
    ].join("\n"),
  );
}

function listWorkspaceTsdkCandidates(rootDir: string): string[] {
  const candidates: string[] = [];
  let currentDir = path.resolve(rootDir);

  while (true) {
    candidates.push(path.join(currentDir, "node_modules", "typescript", "lib"));
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return candidates;
    }
    currentDir = parentDir;
  }
}

function resolveBundledTsdk(): string | null {
  try {
    const typescriptRuntimePath = requireFromLanguageServerPackage.resolve(
      "typescript/lib/typescript.js",
    );
    return path.dirname(typescriptRuntimePath);
  } catch {
    return null;
  }
}

function findNestedRepositoryRoots(
  rootDir: string,
  currentDir = path.resolve(rootDir),
): string[] {
  const results: string[] = [];

  try {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (!entry.isDirectory()) {
        continue;
      }

      if (
        fullPath !== path.resolve(rootDir) &&
        fs.existsSync(path.join(fullPath, ".git"))
      ) {
        results.push(fullPath);
        continue;
      }

      results.push(...findNestedRepositoryRoots(rootDir, fullPath));
    }
  } catch {
    // Ignore directories that cannot be read.
  }

  return results;
}

function isWithinAnyNestedRepository(
  filePath: string,
  nestedRepositoryRoots: readonly string[],
): boolean {
  const resolvedFilePath = path.resolve(filePath);

  return nestedRepositoryRoots.some(
    (nestedRoot) =>
      resolvedFilePath === nestedRoot ||
      resolvedFilePath.startsWith(`${nestedRoot}${path.sep}`),
  );
}

function filterFilesOutsideNestedRepositories(
  filePaths: readonly string[],
  nestedRepositoryRoots: readonly string[],
): string[] {
  return filePaths.filter(
    (filePath) =>
      !isWithinAnyNestedRepository(filePath, nestedRepositoryRoots),
  );
}

export function enumerateProjectFiles(
  rootDir: string,
  options: ResolveWorkspaceTsdkOptions = {},
): string[] {
  const resolvedRoot = path.resolve(rootDir);
  const nestedRepositoryRoots = findNestedRepositoryRoots(resolvedRoot);
  const tsdk = resolveWorkspaceTsdk(resolvedRoot, options);
  const { typescript: ts } = loadTsdkByPath(tsdk, undefined);
  const tsconfigPath = ts.findConfigFile(
    resolvedRoot,
    ts.sys.fileExists,
    "tsconfig.json",
  );
  const files = new Set<string>(
    filterFilesOutsideNestedRepositories(
      tsconfigPath
        ? collectReferencedProjectFiles(ts, tsconfigPath)
        : [],
      nestedRepositoryRoots,
    ),
  );
  for (const fileName of findFeatureTypeFiles(resolvedRoot, nestedRepositoryRoots)) {
    files.add(fileName);
  }

  return [...files].filter(isSupportedDiagnosticFile);
}

function collectReferencedProjectFiles(
  ts: typeof import("typescript"),
  tsconfigPath: string,
  seen = new Set<string>(),
): string[] {
  const resolvedConfigPath = path.resolve(tsconfigPath);
  if (seen.has(resolvedConfigPath)) {
    return [];
  }
  seen.add(resolvedConfigPath);

  const parsedCommandLine = ts.parseJsonConfigFileContent(
    ts.readConfigFile(resolvedConfigPath, ts.sys.readFile).config,
    ts.sys,
    path.dirname(resolvedConfigPath),
  );

  return [
    ...parsedCommandLine.fileNames.map((fileName) => path.resolve(fileName)),
    ...(parsedCommandLine.projectReferences ?? []).flatMap((reference) =>
      collectReferencedProjectFiles(
        ts,
        ts.resolveProjectReferencePath(reference),
        seen,
      ),
    ),
  ];
}

function collectTypeScriptProjectDiagnostics(
  rootDir: string,
  tsdk: string,
): ProjectDiagnosticBatch[] {
  const nestedRepositoryRoots = findNestedRepositoryRoots(rootDir);
  const { typescript: ts } = loadTsdkByPath(tsdk, undefined);
  const tsconfigPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
  const parsedCommandLine = tsconfigPath
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(tsconfigPath, ts.sys.readFile).config,
        ts.sys,
        path.dirname(tsconfigPath),
      )
    : ts.parseJsonConfigFileContent({}, ts.sys, rootDir);

  const builder = ts.createIncrementalProgram({
    rootNames: filterFilesOutsideNestedRepositories(
      parsedCommandLine.fileNames,
      nestedRepositoryRoots,
    ),
    options: parsedCommandLine.options,
    projectReferences: parsedCommandLine.projectReferences,
    configFileParsingDiagnostics: parsedCommandLine.errors,
  });
  const program = builder.getProgram();

  const diagnosticsByFile = new Map<string, Diagnostic[]>();

  const pushDiagnostic = (diagnostic: import("typescript").Diagnostic): void => {
    const sourceFile = diagnostic.file;
    if (!sourceFile || diagnostic.start == null) {
      return;
    }

    const start = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
    const end = sourceFile.getLineAndCharacterOfPosition(
      diagnostic.start + (diagnostic.length ?? 0),
    );
    const filePath = path.resolve(sourceFile.fileName);
    const existing = diagnosticsByFile.get(filePath) ?? [];
    existing.push({
      range: {
        start: { line: start.line, character: start.character },
        end: { line: end.line, character: end.character },
      },
      severity:
        diagnostic.category === ts.DiagnosticCategory.Warning
          ? 2
          : diagnostic.category === ts.DiagnosticCategory.Suggestion ||
              diagnostic.category === ts.DiagnosticCategory.Message
            ? 3
            : 1,
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      source: "typescript",
      relatedInformation: diagnostic.relatedInformation?.flatMap((related) => {
        if (!related.file || related.start == null) {
          return [];
        }

        const relatedStart = related.file.getLineAndCharacterOfPosition(related.start);
        const relatedEnd = related.file.getLineAndCharacterOfPosition(
          related.start + (related.length ?? 0),
        );

        return [
          {
            location: {
              uri: URI.file(path.resolve(related.file.fileName)).toString(),
              range: {
                start: {
                  line: relatedStart.line,
                  character: relatedStart.character,
                },
                end: {
                  line: relatedEnd.line,
                  character: relatedEnd.character,
                },
              },
            },
            message: ts.flattenDiagnosticMessageText(related.messageText, "\n"),
          },
        ];
      }),
    });
    diagnosticsByFile.set(filePath, existing);
  };

  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    pushDiagnostic(diagnostic);
  }

  return [...diagnosticsByFile.entries()].map(([filePath, diagnostics]) => ({
    filePath,
    diagnostics,
  }));
}

export async function createFeatureTypeLanguageServerClient(
  options: CreateFeatureTypeLanguageServerClientOptions,
): Promise<FeatureTypeLanguageServerClient> {
  const rootDir = path.resolve(options.rootDir);
  const tsdk = resolveWorkspaceTsdk(rootDir, options);
  const { scriptPath: serverModulePath, execArgv: serverExecArgv } =
    resolveLanguageServerModule();
  const childProcess = cp.fork(
    serverModulePath,
    ["--stdio", `--clientProcessId=${process.pid.toString()}`],
    {
      execArgv: serverExecArgv,
      env: process.env,
      cwd: rootDir,
      stdio: "pipe",
    },
  );

  if (!childProcess.stdout || !childProcess.stdin) {
    throw new Error(
      "Failed to start the FeatureType language server with stdio transport.",
    );
  }

  const connection = createProtocolConnection(
    childProcess.stdout,
    childProcess.stdin,
  );
  const openedDocuments = new Map<string, SyncedDocument>();
  // Tracks absolute paths opened as virtual (content-only, no disk read).
  const virtualFilePaths = new Set<string>();
  const nestedRepositoryRoots = findNestedRepositoryRoots(rootDir);
  let knownWatchedFiles = new Set(
    findWatchedFiles(rootDir, nestedRepositoryRoots),
  );
  let workspaceBootstrapFile: string | undefined;
  let disposed = false;

  connection.listen();
  connection.onRequest(ConfigurationRequest.type, (params: { items: unknown[] }) =>
    params.items.map(() => undefined),
  );
  connection.onDispose(() => {
    connection.end();
  });
  childProcess.on("exit", () => {
    disposed = true;
  });

  await connection.sendRequest(InitializeRequest.type, {
    processId: childProcess.pid ?? null,
    rootUri: URI.file(rootDir).toString(),
    workspaceFolders: null,
    initializationOptions: {
      typescript: { tsdk },
    },
    capabilities: {
      workspace: {
        diagnostics: {
          refreshSupport: true,
        },
      },
      textDocument: {
        codeAction: {
          codeActionLiteralSupport: {
            codeActionKind: {
              valueSet: [
                "",
                "quickfix",
                "refactor",
                "refactor.extract",
                "refactor.inline",
                "refactor.move",
                "refactor.rewrite",
                "source",
                "source.organizeImports",
                "source.fixAll",
              ],
            },
          },
          dataSupport: true,
          resolveSupport: {
            properties: ["edit"],
          },
          isPreferredSupport: true,
          disabledSupport: true,
        },
        diagnostic: {
          relatedDocumentSupport: true,
        },
        signatureHelp: {
          contextSupport: true,
        },
      },
    },
  });
  await connection.sendNotification(InitializedNotification.type, {});

  const syncDocumentFromDisk = async (
    filePath: string,
    mode: "open" | "refresh",
  ): Promise<SyncedDocument | null> => {
    const absPath = resolveFilePath(rootDir, filePath);
    const uri = URI.file(absPath).toString();
    const current = openedDocuments.get(uri);

    // Virtual files are already open in the LSP session with caller-supplied
    // content. Never read from disk for them — doing so would blow up on
    // non-existent files and would also clobber content the caller registered.
    if (current && virtualFilePaths.has(absPath)) {
      return current;
    }

    if (!fs.existsSync(absPath)) {
      if (current) {
        openedDocuments.delete(uri);
        await connection.sendNotification(DidCloseTextDocumentNotification.type, {
          textDocument: { uri },
        });
      }
      return null;
    }

    const languageId = getLanguageId(absPath);
    const text = fs.readFileSync(absPath, "utf-8");

    if (!current) {
      const document = { uri, languageId, version: 1, text };
      openedDocuments.set(uri, document);
      await connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: document,
      });
      return document;
    }

    if (mode === "refresh" && current.text !== text) {
      const document = {
        uri,
        languageId,
        version: current.version + 1,
        text,
      };
      openedDocuments.set(uri, document);
      await connection.sendNotification(
        DidChangeTextDocumentNotification.type,
        {
          textDocument: {
            uri,
            version: document.version,
          },
          contentChanges: [{ text }],
        },
      );
      return document;
    }

    return current;
  };

  const refreshOpenedDiskDocuments = async (): Promise<void> => {
    for (const document of [...openedDocuments.values()]) {
      const absPath = URI.parse(document.uri).fsPath;
      if (virtualFilePaths.has(absPath)) {
        continue;
      }
      await syncDocumentFromDisk(absPath, "refresh");
    }
  };

  const getDocumentDiagnostics = async (
    filePath: string,
  ): Promise<Diagnostic[]> => {
    const absPath = resolveFilePath(rootDir, filePath);

    await refreshOpenedDiskDocuments();

    if (virtualFilePaths.has(absPath)) {
      const document = await syncDocumentFromDisk(filePath, "refresh");
      if (!document) {
        return [];
      }

      const report = await connection.sendRequest(DocumentDiagnosticRequest.type, {
        textDocument: { uri: document.uri },
      });

      if (report.kind === DocumentDiagnosticReportKind.Full) {
        return report.items;
      }

      return [];
    }

    if (!fs.existsSync(absPath)) {
      return [];
    }

    await ensureWorkspaceInitialized();

    const report = await connection.sendRequest(DocumentDiagnosticRequest.type, {
      textDocument: { uri: URI.file(absPath).toString() },
    });

    if (report.kind === DocumentDiagnosticReportKind.Full) {
      return report.items;
    }

    return [];
  };

  const getDocumentCodeActions = async (
    filePath: string,
    range: Range,
    diagnostics: Diagnostic[],
  ): Promise<Array<CodeAction | Command>> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return [];
    }
    const actions =
      (await connection.sendRequest(CodeActionRequest.type, {
        textDocument: { uri: document.uri },
        range,
        context: { diagnostics },
      })) ?? [];

    return Promise.all(
      actions.map(async (action) => {
        if (!supportsCodeActionResolve(action)) {
          return action;
        }

        try {
          return (
            (await connection.sendRequest(CodeActionResolveRequest.type, action)) ??
            action
          );
        } catch {
          return action;
        }
      }),
    );
  };

  const getDocumentCompletions = async (
    filePath: string,
    position: Position,
  ): Promise<CompletionList> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return {
        isIncomplete: false,
        items: [],
      };
    }

    return normalizeCompletionResult(
      (await connection.sendRequest(CompletionRequest.type, {
        textDocument: { uri: document.uri },
        position,
      })) as CompletionItem[] | CompletionList | null,
    );
  };

  const resolveCompletionItem = async (
    item: CompletionItem,
  ): Promise<CompletionItem> => {
    try {
      return (
        (await connection.sendRequest(CompletionResolveRequest.type, item)) ??
        item
      );
    } catch {
      return item;
    }
  };

  const getDocumentHover = async (
    filePath: string,
    position: Position,
  ): Promise<Hover | null> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return null;
    }
    return (
      (await connection.sendRequest(HoverRequest.type, {
        textDocument: { uri: document.uri },
        position,
      })) ?? null
    );
  };

  const getDocumentSignatureHelp = async (
    filePath: string,
    position: Position,
  ): Promise<SignatureHelp | null> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return null;
    }

    return await requestSignatureHelpWithFallback({
      text: document.text,
      position,
      request: async (candidatePosition, context) =>
        (await connection.sendRequest(SignatureHelpRequest.type, {
          textDocument: { uri: document.uri },
          position: candidatePosition,
          context: {
            triggerKind: SignatureHelpTriggerKind.Invoked,
            isRetrigger: context.isRetrigger,
          },
        })) ?? null,
    });
  };

  const getDocumentDefinition = async (
    filePath: string,
    position: Position,
  ): Promise<Array<Location | LocationLink>> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return [];
    }
    const result = (await connection.sendRequest(DefinitionRequest.type, {
        textDocument: { uri: document.uri },
        position,
      })) as
      | Location
      | LocationLink[]
      | Location[]
      | null;
    if (!result) {
      return [];
    }
    return Array.isArray(result) ? result : [result];
  };

  const normalizeLocationResult = (
    result:
      | Location
      | Location[]
      | LocationLink[]
      | null,
  ): Array<Location | LocationLink> =>
    !result ? [] : Array.isArray(result) ? result : [result];

  const getDocumentReferences = async (
    filePath: string,
    position: Position,
  ): Promise<Location[]> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return [];
    }
    return (
      (await connection.sendRequest(ReferencesRequest.type, {
        textDocument: { uri: document.uri },
        position,
        context: { includeDeclaration: true },
      })) ?? []
    );
  };

  const getDocumentTypeDefinition = async (
    filePath: string,
    position: Position,
  ): Promise<Array<Location | LocationLink>> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return [];
    }
    return normalizeLocationResult(
      (await connection.sendRequest(TypeDefinitionRequest.type, {
        textDocument: { uri: document.uri },
        position,
      })) as
        | Location
        | Location[]
        | LocationLink[]
        | null,
    );
  };

  const getDocumentImplementations = async (
    filePath: string,
    position: Position,
  ): Promise<Array<Location | LocationLink>> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return [];
    }
    return normalizeLocationResult(
      (await connection.sendRequest(ImplementationRequest.type, {
        textDocument: { uri: document.uri },
        position,
      })) as
        | Location
        | Location[]
        | LocationLink[]
        | null,
    );
  };

  const getDocumentHighlights = async (
    filePath: string,
    position: Position,
  ): Promise<DocumentHighlight[]> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return [];
    }
    return (
      (await connection.sendRequest(DocumentHighlightRequest.type, {
        textDocument: { uri: document.uri },
        position,
      })) ?? []
    );
  };

  const getDocumentImportReferences = async (
    filePath: string,
  ): Promise<Location[]> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return [];
    }
    return (
      (await connection.sendRequest(FindFileReferenceRequest.type, {
        textDocument: { uri: document.uri },
      })) ?? []
    );
  };

  const getWorkspaceDiagnostics = async (): Promise<
    Array<{ filePath: string; diagnostics: Diagnostic[] }> | null
  > => {
    await refreshOpenedDiskDocuments();
    await ensureWorkspaceInitialized();

    try {
      const report = await connection.sendRequest(WorkspaceDiagnosticRequest.type, {
        previousResultIds: [],
      });

      if (!report) {
        return [];
      }

      return report.items
        .filter((item) => item.kind === DocumentDiagnosticReportKind.Full)
        .map((item) => ({
          filePath: URI.parse(item.uri).fsPath,
          diagnostics: item.items,
        }));
    } catch {
      const seen = new Set<string>();
      const projectDiagnostics = collectTypeScriptProjectDiagnostics(rootDir, tsdk).map(
        (entry) => {
          seen.add(path.resolve(entry.filePath));
          return entry;
        },
      );

      const extraFiles = [
        ...findFeatureTypeFiles(rootDir, nestedRepositoryRoots),
        ...[...virtualFilePaths].filter((filePath) => !seen.has(path.resolve(filePath))),
      ].filter(
        (filePath) =>
          !isWithinAnyNestedRepository(filePath, nestedRepositoryRoots),
      );

      const extraDiagnostics = await Promise.all(
        extraFiles.map(async (filePath) => ({
          filePath,
          diagnostics: await getDocumentDiagnostics(filePath),
        })),
      );

      return [...projectDiagnostics, ...extraDiagnostics];
    }
  };

  const ensureWorkspaceInitialized = async (): Promise<void> => {
    if (openedDocuments.size > 0) {
      return;
    }
    const projectFiles = enumerateProjectFiles(rootDir, { tsdk });
    workspaceBootstrapFile =
      projectFiles.find((filePath) => !filePath.endsWith(".featuretype")) ??
      projectFiles[0];
    if (workspaceBootstrapFile) {
      await syncDocumentFromDisk(workspaceBootstrapFile, "open");
    }
  };

  const getWorkspaceSymbols = async (
    query: string,
  ): Promise<WorkspaceSymbol[]> => {
    await ensureWorkspaceInitialized();
    return (await connection.sendRequest(WorkspaceSymbolRequest.type, { query })) ?? [];
  };

  const prepareDocumentRename = async (
    filePath: string,
    position: Position,
  ): Promise<PrepareRenameResult | null> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return null;
    }
    return (
      (await connection.sendRequest(PrepareRenameRequest.type, {
        textDocument: { uri: document.uri },
        position,
      })) ?? null
    );
  };

  const getDocumentRenameEdits = async (
    filePath: string,
    position: Position,
    newName: string,
  ): Promise<WorkspaceEdit | null> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return null;
    }
    return (
      (await connection.sendRequest(RenameRequest.type, {
        textDocument: { uri: document.uri },
        position,
        newName,
      })) ?? null
    );
  };

  const getDocumentFileRenameEdits = async (
    oldFilePath: string,
    newFilePath: string,
  ): Promise<WorkspaceEdit | null> => {
    const oldUri = URI.file(resolveFilePath(rootDir, oldFilePath)).toString();
    const newUri = URI.file(resolveFilePath(rootDir, newFilePath)).toString();
    return (
      (await connection.sendRequest(WillRenameFilesRequest.type, {
        files: [{ oldUri, newUri }],
      })) ?? null
    );
  };

  const getDocumentCallHierarchyItems = async (
    filePath: string,
    position: Position,
  ): Promise<CallHierarchyItem[]> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return [];
    }
    return (
      (await connection.sendRequest(CallHierarchyPrepareRequest.type, {
        textDocument: { uri: document.uri },
        position,
      })) ?? []
    );
  };

  const getCallHierarchyIncomingCalls = async (
    item: CallHierarchyItem,
  ): Promise<CallHierarchyIncomingCall[]> =>
    (await connection.sendRequest(CallHierarchyIncomingCallsRequest.type, { item })) ?? [];

  const getCallHierarchyOutgoingCalls = async (
    item: CallHierarchyItem,
  ): Promise<CallHierarchyOutgoingCall[]> =>
    (await connection.sendRequest(CallHierarchyOutgoingCallsRequest.type, { item })) ?? [];

  const getDocumentSymbols = async (
    filePath: string,
  ): Promise<Array<DocumentSymbol | SymbolInformation>> => {
    const document = await syncDocumentFromDisk(filePath, "refresh");
    if (!document) {
      return [];
    }
    return (
      (await connection.sendRequest(DocumentSymbolRequest.type, {
        textDocument: { uri: document.uri },
      })) ?? []
    );
  };

  const notifyWatchedFiles = async (filePaths: string[]): Promise<void> => {
    const normalizedPaths = [...new Set(filePaths.map((filePath) =>
      resolveFilePath(rootDir, filePath)
    ))];

    await refreshOpenedDiskDocuments();
    const previousKnownWatchedFiles = new Set(knownWatchedFiles);

    for (const filePath of normalizedPaths) {
      if (fs.existsSync(filePath)) {
        knownWatchedFiles.add(filePath);
      } else {
        knownWatchedFiles.delete(filePath);
      }
    }

    await connection.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: normalizedPaths.map((filePath) => ({
        uri: URI.file(filePath).toString(),
        type: determineWatchedFileChangeType(
          filePath,
          previousKnownWatchedFiles,
          knownWatchedFiles,
        ),
      })),
    });
  };

  const openVirtualFile = async (
    filePath: string,
    content: string,
  ): Promise<SyncedDocument> => {
    const absPath = resolveFilePath(rootDir, filePath);
    const uri = URI.file(absPath).toString();
    const languageId = getLanguageId(absPath);
    const current = openedDocuments.get(uri);
    const shouldNormalizeImportSpecifiers = NORMALIZABLE_LANGUAGE_IDS.has(languageId);
    const updatedContent = shouldNormalizeImportSpecifiers
      ? normalizeVirtualImportSpecifiers(content)
      : content;

    virtualFilePaths.add(absPath);

    if (!current) {
      const document = {
        uri,
        languageId,
        version: 1,
        text: updatedContent,
      };
      openedDocuments.set(uri, document);
      await connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: document,
      });
      return document;
    }

    // Update if content changed.
    if (current.text !== updatedContent) {
      const document = {
        uri,
        languageId,
        version: current.version + 1,
        text: updatedContent,
      };
      openedDocuments.set(uri, document);
      await connection.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version: document.version },
        contentChanges: [{ text: updatedContent }],
      });
      return document;
    }

    return current;
  };

  const closeVirtualFile = async (filePath: string): Promise<void> => {
    const absPath = resolveFilePath(rootDir, filePath);
    const uri = URI.file(absPath).toString();
    virtualFilePaths.delete(absPath);
    if (openedDocuments.has(uri)) {
      openedDocuments.delete(uri);
      await connection.sendNotification(DidCloseTextDocumentNotification.type, {
        textDocument: { uri },
      });
    }
  };

  const dispose = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    disposed = true;

    try {
      await connection.sendRequest(ShutdownRequest.type);
    } catch {
      // Ignore shutdown failures during teardown.
    }

    connection.dispose();
    if (!childProcess.killed) {
      childProcess.kill();
    }
  };

  return {
    rootDir,
    tsdk,
    async openFileFromDisk(filePath: string) {
      const document = await syncDocumentFromDisk(filePath, "open");
      if (!document) {
        throw new Error(`File not found: ${resolveFilePath(rootDir, filePath)}`);
      }
      return document;
    },
    async refreshFileFromDisk(filePath: string) {
      const document = await syncDocumentFromDisk(filePath, "refresh");
      if (!document) {
        throw new Error(`File not found: ${resolveFilePath(rootDir, filePath)}`);
      }
      return document;
    },
    openVirtualFile,
    closeVirtualFile,
    getVirtualFilePaths() {
      return [...virtualFilePaths];
    },
    getVirtualFileContent(filePath: string): string | undefined {
      const absPath = resolveFilePath(rootDir, filePath);
      if (!virtualFilePaths.has(absPath)) return undefined;
      const uri = URI.file(absPath).toString();
      return openedDocuments.get(uri)?.text;
    },
    getWorkspaceDiagnostics,
    getDocumentDiagnostics,
    getDocumentCodeActions,
    getDocumentCompletions,
    resolveCompletionItem,
    getDocumentHover,
    getDocumentSignatureHelp,
    getDocumentDefinition,
    getDocumentReferences,
    getDocumentTypeDefinition,
    getDocumentImplementations,
    getDocumentHighlights,
    getDocumentImportReferences,
    getWorkspaceSymbols,
    prepareDocumentRename,
    getDocumentRenameEdits,
    getDocumentFileRenameEdits,
    getDocumentCallHierarchyItems,
    getCallHierarchyIncomingCalls,
    getCallHierarchyOutgoingCalls,
    getDocumentSymbols,
    notifyWatchedFiles,
    dispose,
  };
}

export async function createDiagnosticsSession(
  options: CreateFeatureTypeLanguageServerClientOptions,
): Promise<DiagnosticsSession> {
  const rootDir = path.resolve(options.rootDir);
  const client = await createFeatureTypeLanguageServerClient({
    rootDir,
    tsdk: options.tsdk,
  });

  return {
    rootDir,
    tsdk: client.tsdk,
    getProjectFileNames() {
      const diskFiles = enumerateProjectFiles(rootDir, { tsdk: client.tsdk });
      const virtualFiles = client.getVirtualFilePaths().filter(
        (p) => isSupportedDiagnosticFile(p) && !diskFiles.includes(p),
      );
      return Promise.resolve([...diskFiles, ...virtualFiles]);
    },
    getWorkspaceDiagnostics() {
      return client.getWorkspaceDiagnostics();
    },
    async openVirtualFile(filePath: string, content: string) {
      await client.openVirtualFile(filePath, content);
    },
    async closeVirtualFile(filePath: string) {
      await client.closeVirtualFile(filePath);
    },
    isVirtualFile(filePath: string) {
      const absPath = path.resolve(rootDir, filePath);
      return client.getVirtualFilePaths().includes(absPath);
    },
    getFileContent(filePath: string): string {
      const virtualContent = client.getVirtualFileContent(filePath);
      if (virtualContent !== undefined) return virtualContent;
      const absPath = path.resolve(rootDir, filePath);
      return fs.readFileSync(absPath, "utf-8");
    },
    getFileDiagnostics(filePath: string) {
      return client.getDocumentDiagnostics(filePath);
    },
    getFileCodeActions(
      filePath: string,
      range: Range,
      diagnostics: Diagnostic[],
    ) {
      return client.getDocumentCodeActions(filePath, range, diagnostics);
    },
    getFileCompletions(filePath: string, position: Position) {
      return client.getDocumentCompletions(filePath, position);
    },
    resolveCompletionItem(item: CompletionItem) {
      return client.resolveCompletionItem(item);
    },
    getFileHover(filePath: string, position: Position) {
      return client.getDocumentHover(filePath, position);
    },
    getFileSignatureHelp(filePath: string, position: Position) {
      return client.getDocumentSignatureHelp(filePath, position);
    },
    getFileDefinition(filePath: string, position: Position) {
      return client.getDocumentDefinition(filePath, position);
    },
    getFileReferences(filePath: string, position: Position) {
      return client.getDocumentReferences(filePath, position);
    },
    getFileTypeDefinition(filePath: string, position: Position) {
      return client.getDocumentTypeDefinition(filePath, position);
    },
    getFileImplementations(filePath: string, position: Position) {
      return client.getDocumentImplementations(filePath, position);
    },
    getFileDocumentHighlights(filePath: string, position: Position) {
      return client.getDocumentHighlights(filePath, position);
    },
    getFileImportReferences(filePath: string) {
      return client.getDocumentImportReferences(filePath);
    },
    getWorkspaceSymbols(query: string) {
      return client.getWorkspaceSymbols(query);
    },
    prepareFileRename(filePath: string, position: Position) {
      return client.prepareDocumentRename(filePath, position);
    },
    getFileRenameEdits(
      filePath: string,
      position: Position,
      newName: string,
    ) {
      return client.getDocumentRenameEdits(filePath, position, newName);
    },
    getWorkspaceFileRenameEdits(oldFilePath: string, newFilePath: string) {
      return client.getDocumentFileRenameEdits(oldFilePath, newFilePath);
    },
    getFileCallHierarchyItems(filePath: string, position: Position) {
      return client.getDocumentCallHierarchyItems(filePath, position);
    },
    getCallHierarchyIncomingCalls(item: CallHierarchyItem) {
      return client.getCallHierarchyIncomingCalls(item);
    },
    getCallHierarchyOutgoingCalls(item: CallHierarchyItem) {
      return client.getCallHierarchyOutgoingCalls(item);
    },
    getFileDocumentSymbols(filePath: string) {
      return client.getDocumentSymbols(filePath);
    },
    async notifyFilesChanged(filePaths: string[]) {
      await client.notifyWatchedFiles(filePaths);
    },
    async notifyFileChanged(filePath: string) {
      await client.notifyWatchedFiles([filePath]);
    },
    dispose() {
      return client.dispose();
    },
  };
}

function normalizeTsdkPath(rootDir: string, tsdk: string): string {
  const candidate = path.isAbsolute(tsdk) ? tsdk : path.resolve(rootDir, tsdk);

  if (hasTypeScriptRuntime(candidate)) {
    return candidate;
  }

  if (
    path.basename(candidate) === "typescript.js" &&
    fs.existsSync(candidate)
  ) {
    return path.dirname(candidate);
  }

  throw new Error(
    [
      `Invalid TypeScript SDK path for ${rootDir}.`,
      `Expected a directory containing typescript.js, received: ${candidate}`,
    ].join("\n"),
  );
}

function hasTypeScriptRuntime(tsdkPath: string): boolean {
  return fs.existsSync(path.join(tsdkPath, "typescript.js"));
}

function resolveFilePath(rootDir: string, filePath: string): string {
  return path.resolve(rootDir, filePath);
}

function determineWatchedFileChangeType(
  filePath: string,
  previousKnownWatchedFiles: ReadonlySet<string>,
  nextKnownWatchedFiles: ReadonlySet<string>,
): FileChangeType {
  const resolvedFilePath = path.resolve(filePath);
  const existsOnDisk = fs.existsSync(resolvedFilePath);
  const existedBefore = previousKnownWatchedFiles.has(resolvedFilePath);
  const existsAfter = nextKnownWatchedFiles.has(resolvedFilePath) || existsOnDisk;

  if (!existedBefore && existsAfter) {
    return FileChangeType.Created;
  }

  if (existedBefore && !existsAfter) {
    return FileChangeType.Deleted;
  }

  return existsAfter ? FileChangeType.Changed : FileChangeType.Deleted;
}

function isSupportedDiagnosticFile(fileName: string): boolean {
  return (
    [
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".json",
      ".featuretype",
    ].some((suffix) => fileName.endsWith(suffix)) ||
    fileName.endsWith(".d.ts")
  );
}

function getLanguageId(fileName: string): string {
  if (fileName.endsWith(".featuretype")) return "featuretype";
  if (fileName.endsWith(".tsx")) return "typescriptreact";
  if (fileName.endsWith(".jsx")) return "javascriptreact";
  if (
    fileName.endsWith(".ts") ||
    fileName.endsWith(".mts") ||
    fileName.endsWith(".cts") ||
    fileName.endsWith(".d.ts")
  ) {
    return "typescript";
  }
  if (
    fileName.endsWith(".js") ||
    fileName.endsWith(".mjs") ||
    fileName.endsWith(".cjs")
  ) {
    return "javascript";
  }
  if (fileName.endsWith(".json")) return "json";

  throw new Error(`Unsupported diagnostic file type: ${fileName}`);
}

function findFeatureTypeFiles(
  dir: string,
  nestedRepositoryRoots: readonly string[] = [],
): string[] {
  const results: string[] = [];

  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        nestedRepositoryRoots.includes(fullPath)
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        results.push(...findFeatureTypeFiles(fullPath, nestedRepositoryRoots));
        continue;
      }

      if (entry.name.endsWith(".featuretype")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore directories that cannot be read.
  }

  return results;
}

function findWatchedFiles(
  dir: string,
  nestedRepositoryRoots: readonly string[] = [],
): string[] {
  const results: string[] = [];

  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        nestedRepositoryRoots.includes(fullPath)
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        results.push(...findWatchedFiles(fullPath, nestedRepositoryRoots));
        continue;
      }

      if (isSupportedDiagnosticFile(fullPath)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore directories that cannot be read.
  }

  return results;
}
