/**
 * In-process Volar/TypeScript language service host.
 *
 * Sets up a full Volar language service without LSP transport,
 * suitable for programmatic access from MCP tools.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  createLanguage,
  type Language,
} from "@volar/language-core";
import {
  createLanguageService,
  createUriMap,
  type LanguageService,
  type LanguageServiceEnvironment,
  type LanguageServicePlugin,
  type FileType,
} from "@volar/language-service";
import {
  createSys,
  createLanguageServiceHost,
  resolveFileLanguageId,
  type TypeScriptProjectHost,
} from "@volar/typescript";
import { create as createTypeScriptServices } from "volar-service-typescript";
import { URI } from "vscode-uri";
import ts from "typescript";

import {
  featureTypeLanguagePlugin,
  createFeatureTypeServicePlugin,
} from "@featuretype/service";

export interface FileStatus {
  exists: boolean;
  inProjectGraph: boolean;
  isFeatureType: boolean;
  isInRoot: boolean;
}

export interface VolarHost {
  languageService: LanguageService;
  language: Language<URI>;
  /** Notify the host that a file has changed on disk. */
  notifyFileChanged(filePath: string): void;
  /** Get the project root directory. */
  rootDir: string;
  /** Get all project file names (from tsconfig + .featuretype discovery). */
  getProjectFileNames(): string[];
  /** Check file status relative to the project graph. */
  getFileStatus(filePath: string): FileStatus;
  dispose(): void;
}

export function createVolarHost(projectRoot: string): VolarHost {
  const rootDir = path.resolve(projectRoot);
  const rootUri = URI.file(rootDir);

  // --- URI converter ---
  const uriConverter = {
    asUri(fileName: string): URI {
      return URI.file(fileName);
    },
    asFileName(uri: URI): string {
      return uri.fsPath;
    },
  };

  // --- Environment (no LSP, just filesystem) ---
  const env: LanguageServiceEnvironment = {
    workspaceFolders: [rootUri],
    fs: {
      stat(uri: URI) {
        try {
          const stat = fs.statSync(uri.fsPath);
          return {
            type: stat.isFile() ? 1 as FileType : stat.isDirectory() ? 2 as FileType : 0 as FileType,
            ctime: stat.ctimeMs,
            mtime: stat.mtimeMs,
            size: stat.size,
          };
        } catch {
          return undefined;
        }
      },
      readDirectory(uri: URI) {
        try {
          const entries = fs.readdirSync(uri.fsPath, { withFileTypes: true });
          return entries.map((e) => [
            e.name,
            e.isFile() ? 1 as FileType : e.isDirectory() ? 2 as FileType : 0 as FileType,
          ] as [string, FileType]);
        } catch {
          return [];
        }
      },
      readFile(uri: URI) {
        try {
          return fs.readFileSync(uri.fsPath, "utf-8");
        } catch {
          return undefined;
        }
      },
    },
  };

  // --- Find tsconfig ---
  const tsconfigPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
  const parsedCommandLine = tsconfigPath
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(tsconfigPath, ts.sys.readFile).config,
        ts.sys,
        path.dirname(tsconfigPath),
      )
    : ts.parseJsonConfigFileContent({}, ts.sys, rootDir);

  // --- Project host ---
  let projectVersion = 0;
  const projectHost: TypeScriptProjectHost = {
    getCurrentDirectory: () => rootDir,
    getCompilationSettings: () => parsedCommandLine.options,
    getScriptFileNames: () => parsedCommandLine.fileNames,
    getProjectVersion: () => String(projectVersion),
    getProjectReferences: () => parsedCommandLine.projectReferences,
    getLocalizedDiagnosticMessages: () => undefined,
  };

  // --- Create sys ---
  const sys = createSys(ts.sys, env, () => rootDir, uriConverter);

  // --- File snapshot cache ---
  const fsFileSnapshots = createUriMap<[number | undefined, ts.IScriptSnapshot | undefined]>(sys.useCaseSensitiveFileNames);

  // --- Create language (following @volar/language-server pattern) ---
  const language = createLanguage<URI>(
    [
      featureTypeLanguagePlugin,
      { getLanguageId: (uri: URI) => resolveFileLanguageId(uri.path) },
    ],
    createUriMap(sys.useCaseSensitiveFileNames),
    (uri, includeFsFiles) => {
      if (!includeFsFiles) {
        language.scripts.delete(uri);
        return;
      }

      const cache = fsFileSnapshots.get(uri);
      const fileName = uriConverter.asFileName(uri);
      const modifiedTime = sys.getModifiedTime?.(fileName)?.valueOf();
      if (!cache || cache[0] !== modifiedTime) {
        if (sys.fileExists(fileName)) {
          const text = sys.readFile(fileName);
          const snapshot = text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
          fsFileSnapshots.set(uri, [modifiedTime, snapshot]);
        } else {
          fsFileSnapshots.set(uri, [modifiedTime, undefined]);
        }
      }

      const snapshot = fsFileSnapshots.get(uri)?.[1];
      if (snapshot) {
        language.scripts.set(uri, snapshot);
      } else {
        language.scripts.delete(uri);
      }
    },
  );

  // --- Create TS language service host ---
  const { languageServiceHost, getExtraServiceScript } =
    createLanguageServiceHost(ts, sys, language, uriConverter.asUri, projectHost);

  // --- Project context ---
  const projectContext = {
    typescript: {
      configFileName: tsconfigPath,
      sys,
      languageServiceHost,
      getExtraServiceScript,
      uriConverter,
    },
  };

  // --- Service plugins ---
  const servicePlugins: LanguageServicePlugin[] = [
    ...createTypeScriptServices(ts),
    createFeatureTypeServicePlugin(),
  ];

  // --- Create language service ---
  const languageService = createLanguageService(
    language,
    servicePlugins,
    env,
    projectContext,
  );

  // --- Discover .featuretype files ---
  function findFeatureTypeFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...findFeatureTypeFiles(full));
        } else if (entry.name.endsWith(".featuretype")) {
          results.push(full);
        }
      }
    } catch { /* permission errors, etc */ }
    return results;
  }

  const featureTypeFiles = findFeatureTypeFiles(rootDir);
  const tsFileSet = new Set(parsedCommandLine.fileNames.map((f) => path.resolve(f)));

  function notifyFileChanged(filePath: string) {
    const absPath = path.resolve(rootDir, filePath);
    const uri = URI.file(absPath);
    // Invalidate cache so next access re-reads from disk
    fsFileSnapshots.delete(uri);
    projectVersion++;
  }

  function getFileStatus(filePath: string): FileStatus {
    const absPath = path.resolve(rootDir, filePath);
    const exists = fs.existsSync(absPath);
    const isFeatureType = absPath.endsWith(".featuretype");
    const isInRoot = absPath.startsWith(rootDir + path.sep) || absPath === rootDir;
    const inProjectGraph = tsFileSet.has(absPath) || featureTypeFiles.includes(absPath);
    return { exists, inProjectGraph, isFeatureType, isInRoot };
  }

  function getProjectFileNames(): string[] {
    return [...parsedCommandLine.fileNames, ...featureTypeFiles];
  }

  function dispose() {
    languageService.dispose();
    sys.dispose();
  }

  return {
    languageService,
    language,
    notifyFileChanged,
    rootDir,
    getProjectFileNames,
    getFileStatus,
    dispose,
  };
}
