// The workspace's project graph, discovered from configuration rather than
// from what a session happened to load.
//
// Every scope-disclosing answer needs a denominator: "1 project loaded" tells
// a reader nothing about how much of the workspace that is, and the loaded
// set is an accident of call history. Config discovery is cheap — files, not
// programs — and static for the life of a process, so answers can say
// "searched N of M projects" with M being a property of the repository.
//
// The same discovery yields the authored/generated boundary and the inputs to
// TypeScript's own config parser when a caller needs the actual source corpus.

import { existsSync } from "node:fs";
import { isFileInDir } from "@volar/language-server/node.js";
import { dirname, join, relative, resolve } from "pathe";
import ts from "typescript";

export type ProjectGraph = {
  /** Workspace-relative tsconfig paths, sorted. */
  readonly configs: readonly string[];
  /** Workspace-relative build-output directories declared by those configs, sorted, deduplicated. */
  readonly outDirs: readonly string[];
};

const graphs = new Map<string, ProjectGraph>();

export type ProjectSources = {
  readonly config: string;
  readonly files: readonly string[];
};

const discover = (root: string): ProjectGraph => {
  // TypeScript's own directory walk: glob include/exclude, no crawl
  // dependency, and the same file-system view the compiler itself uses.
  const found = ts.sys.readDirectory(
    root,
    [".json"],
    ["**/node_modules/**", "**/.git/**", "**/.*/**"],
    ["**/tsconfig*.json"],
  );
  const configs: string[] = [];
  const outDirs = new Set<string>();
  for (const path of found) {
    configs.push(relative(root, path));
    const parsed = ts.readConfigFile(path, ts.sys.readFile);
    const outDir = (parsed.config?.compilerOptions as { outDir?: string } | undefined)?.outDir;
    if (typeof outDir === "string") {
      const resolved = relative(root, resolve(dirname(path), outDir));
      if (!resolved.startsWith("..")) outDirs.add(resolved);
    }
  }
  // Bundler output. A bundler's config is a TypeScript module — nothing here
  // evaluates one — but its presence declares its documented default output
  // directory, and that is exactly where committed bundles drown literal
  // scans (kek's vite `dist/assets` bundles, 2026-08-20). Every bundler
  // below defaults to `dist` beside its config; a repo that redirects output
  // elsewhere simply gets no exclusion, which errs toward scanning more.
  const bundlerConfigs = ts.sys.readDirectory(
    root,
    undefined,
    ["**/node_modules/**", "**/.git/**", "**/.*/**"],
    ["**/vite.config.*", "**/rolldown.config.*", "**/tsdown.config.*", "**/webpack.config.*"],
  );
  for (const path of bundlerConfigs) {
    outDirs.add(relative(root, join(dirname(path), "dist")));
  }
  return { configs: configs.sort(), outDirs: [...outDirs].sort() };
};

/**
 * The project graph for a workspace root, discovered once per process.
 *
 * Configs change rarely and a stale count misleads mildly where a wrong count
 * misleads badly; per-process is the deliberate freshness. A root that is not
 * a directory answers an empty graph rather than throwing — callers use this
 * for disclosure, and disclosure must never break the answer it decorates.
 */
export const projectGraph = (root: string): ProjectGraph => {
  const key = resolve(root);
  const held = graphs.get(key);
  if (held) return held;
  const graph = existsSync(key) ? discover(key) : { configs: [], outDirs: [] };
  graphs.set(key, graph);
  return graph;
};

/** Source files selected by every configured TypeScript project. */
export const projectSources = (root: string): readonly ProjectSources[] => {
  const key = resolve(root);
  const configs = existsSync(key) ? discover(key).configs : [];
  return configs.map((config): ProjectSources => {
    const absolute = resolve(key, config);
    const commandLine = ts.getParsedCommandLineOfConfigFile(
      absolute,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      },
    );
    return {
      config,
      files:
        commandLine?.fileNames
          .filter((file) => (file === key || isFileInDir(file, key)) && existsSync(file))
          .map((file) => resolve(file)) ?? [],
    };
  });
};
