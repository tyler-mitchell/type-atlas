import { realpath } from "node:fs/promises";
import { containingGitSubmodule, findGitSubmoduleRoots } from "@type-atlas/core";
import { isFileInDir } from "@volar/language-server/node.js";
import { fdir } from "fdir";
import { isGitIgnored } from "globby";
import * as path from "pathe";

const collapsedDirectories = new Set([".git", "node_modules"]);

export const workspaceTree = async (input: {
  readonly workspace: string;
  readonly directory: string;
  readonly depth: number;
  readonly glob?: readonly string[];
  readonly includeIgnored: boolean;
  readonly includeHidden: boolean;
  readonly includeSubmodules: boolean;
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly view: "directories" | "files";
}): Promise<string> => {
  const root = path.resolve(input.workspace);
  const directory = path.resolve(root, input.directory);
  if (directory !== root && !isFileInDir(directory, root)) {
    throw new Error(`Directory is outside the workspace: ${input.directory}`);
  }
  const [realRoot, realDirectory] = await Promise.all([
    realpath(root).then(path.normalize),
    realpath(directory).then(path.normalize),
  ]);
  if (realDirectory !== realRoot && !isFileInDir(realDirectory, realRoot)) {
    throw new Error(`Directory resolves outside the workspace: ${input.directory}`);
  }
  const submoduleRoots = input.includeSubmodules ? [] : await findGitSubmoduleRoots(root);
  const submodule = containingGitSubmodule(directory, submoduleRoots);
  if (submodule) {
    throw new Error(
      `Directory belongs to nested workspace ${path.relative(root, submodule)}. Use that path as workspace or pass includeSubmodules: true.`,
    );
  }

  const isIgnored = input.includeIgnored
    ? () => false
    : await isGitIgnored({
        cwd: directory,
        deep: input.depth,
        followSymbolicLinks: false,
        ignore: ["**/.git/**", "**/node_modules/**"],
      });
  const crawler = new fdir()
    .withRelativePaths()
    .withMaxDepth(input.depth - 1)
    .withErrors()
    .withAbortSignal(input.signal)
    .normalize()
    .globWithOptions([...(input.glob ?? ["**/*"])], { dot: input.includeHidden })
    .filter((file) => file === "." || file.length === 0 || !isIgnored(file))
    .exclude((name, absolute) => {
      const relative = path.relative(directory, absolute);
      return (
        collapsedDirectories.has(name) ||
        (!input.includeHidden && name.startsWith(".")) ||
        containingGitSubmodule(path.resolve(absolute), submoduleRoots) !== undefined ||
        (relative !== "." && relative.length > 0 && isIgnored(`${relative}/`))
      );
    });
  if (input.view === "directories") {
    const crawled = await crawler
      .withMaxFiles(input.limit + 2)
      .onlyDirs()
      .crawl(directory)
      .withPromise();
    const submodules = input.glob
      ? []
      : submoduleRoots.flatMap((submoduleRoot) => {
          if (!isFileInDir(submoduleRoot, directory)) return [];
          const relative = path.relative(directory, submoduleRoot);
          return relative.split("/").length <= input.depth ? [`${relative}/ [submodule]`] : [];
        });
    const directories = [...crawled.filter((entry) => entry !== "."), ...submodules].sort();
    if (directories.length === 0 && input.glob) return "No matching paths.";
    return [
      ...directories.slice(0, input.limit),
      ...(directories.length > input.limit
        ? [`… ${input.limit}-directory limit reached; narrow directory or increase limit.`]
        : []),
    ].join("\n");
  }

  const crawled = await crawler
    .withDirs()
    .withMaxFiles(input.limit + 2)
    .crawl(directory)
    .withPromise();
  const entries = [
    ...crawled
      .filter((entry) => entry !== ".")
      .map((entry) =>
        entry.endsWith("/")
          ? { directory: entry.slice(0, -1), name: undefined }
          : { directory: path.dirname(entry) || ".", name: path.basename(entry) },
      ),
    ...(input.glob
      ? []
      : submoduleRoots.flatMap((submoduleRoot) => {
          if (!isFileInDir(submoduleRoot, directory)) return [];
          const relative = path.relative(directory, submoduleRoot);
          if (relative.split("/").length > input.depth) return [];
          return [
            {
              directory: path.dirname(relative) || ".",
              name: `${path.basename(relative)}/ [submodule]`,
            },
          ];
        })),
  ]
    .sort((left, right) =>
      `${left.directory}/${left.name ?? ""}`.localeCompare(
        `${right.directory}/${right.name ?? ""}`,
      ),
    )
    .slice(0, input.limit + 1);
  const groupedEntries = entries
    .slice(0, input.limit)
    .reduce<Map<string, readonly string[]>>((sections, entry) => {
      const names = sections.get(entry.directory) ?? [];
      return sections.set(
        entry.directory,
        entry.name === undefined ? names : [...names, entry.name],
      );
    }, new Map());
  const sections = [...groupedEntries]
    .sort(
      ([left], [right]) =>
        Number(right === ".") - Number(left === ".") || left.localeCompare(right),
    )
    .flatMap(([relative, names]) => [
      `${relative}/`,
      ...[...names].sort().map((name) => `  ${name}`),
    ]);
  if (sections.length === 0 && input.glob) return "No matching paths.";
  return [
    ...sections,
    ...(entries.length > input.limit
      ? [`… ${input.limit}-entry limit reached; narrow directory or increase limit.`]
      : []),
  ].join("\n");
};
