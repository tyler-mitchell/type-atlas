import { realpath, stat } from "node:fs/promises";
import { containingGitSubmodule, findGitSubmoduleRoots } from "@type-atlas/core";
import type { Row } from "atlascii";
import { isFileInDir } from "@volar/language-server/node.js";
import { fdir } from "fdir";
import { isGitIgnored } from "globby";
import * as path from "pathe";

const collapsedDirectories = new Set([".git", "node_modules"]);

/**
 * What a listing found, before anything decides how it reads.
 *
 * `entries` is the tree itself — one row per directory in the files view, each
 * holding the names inside it; one row per path in the directories view. The
 * bound is reported rather than rendered, so the words belong to the document.
 */
export type WorkspaceListing = {
  readonly entries: readonly Row[];
  readonly over: boolean;
  readonly limit: number;
  readonly filtered: boolean;
};

/** Per-subtree overrides for an expanded directory, each an existing option scoped down. */
export type WorkspaceExpansion = {
  readonly depth?: number;
  readonly glob?: readonly string[];
  readonly includeHidden?: boolean;
  readonly includeIgnored?: boolean;
};

export const workspaceTree = async (input: {
  readonly workspace: string;
  readonly directory: string;
  readonly depth: number;
  readonly glob?: readonly string[];
  /** Subtrees to open deeper than the shared depth, keyed by path relative to
   * `directory` — a number is shorthand for `{ depth }`. */
  readonly expand?: Readonly<Record<string, number | WorkspaceExpansion>>;
  readonly includeIgnored: boolean;
  readonly includeHidden: boolean;
  readonly includeSubmodules: boolean;
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly view: "directories" | "files";
}): Promise<WorkspaceListing> => {
  const root = path.resolve(input.workspace);
  const directory = path.resolve(root, input.directory);
  if (directory !== root && !isFileInDir(directory, root)) {
    throw new Error(`Directory is outside the workspace: ${input.directory}`);
  }
  // `realpath` reports a missing or non-directory path as a raw errno naming an
  // absolute path the caller never wrote. Say which argument was wrong instead.
  const [realRoot, realDirectory] = await Promise.all([
    realpath(root)
      .then(path.normalize)
      .catch(() => {
        throw new Error(`Workspace is not a directory: ${input.workspace}`);
      }),
    realpath(directory)
      .then(path.normalize)
      .catch(() => {
        throw new Error(
          `No directory at ${input.directory} in this workspace. Pass a directory, not a file, and check the path.`,
        );
      }),
  ]);
  if (realDirectory !== realRoot && !isFileInDir(realDirectory, realRoot)) {
    throw new Error(`Directory resolves outside the workspace: ${input.directory}`);
  }
  // A path that exists but is a file crawls into an errno naming `lstat`, which
  // reads as a bug in the tool rather than a wrong argument.
  if (!(await stat(realDirectory)).isDirectory()) {
    throw new Error(
      `${input.directory} is a file. Pass the directory containing it: ${path.relative(root, path.dirname(directory)) || "."}`,
    );
  }
  const submoduleRoots = input.includeSubmodules ? [] : await findGitSubmoduleRoots(root);
  const submodule = containingGitSubmodule(directory, submoduleRoots);
  if (submodule) {
    throw new Error(
      `Directory belongs to nested workspace ${path.relative(root, submodule)}. Use that path as workspace or pass includeSubmodules: true.`,
    );
  }

  // Depth counts levels below the named directory. A file sits at the depth
  // of the directory holding it, so files stop one level earlier than the
  // directories do — asking for depth 1 means the files here, and the
  // directories immediately inside.
  //
  // fdir crawls exactly one root with one option set — its documentation has
  // no multi-root, per-subtree, or merge affordance — so an expansion is one
  // fully-fdir-configured crawl per named subtree, unioned by prefix before
  // the one tree folds. Every crawl carries the same file cap, and the union
  // is sliced at the same limit a plain listing has, so an expanded answer
  // can never outgrow an unexpanded one.
  const crawlScope = async (scope: {
    readonly dir: string;
    readonly depth: number;
    readonly glob?: readonly string[] | undefined;
    readonly includeHidden: boolean;
    readonly includeIgnored: boolean;
  }): Promise<readonly string[]> => {
    const ignored = scope.includeIgnored
      ? () => false
      : await isGitIgnored({
          cwd: scope.dir,
          deep: scope.depth,
          followSymbolicLinks: false,
          ignore: ["**/.git/**", "**/node_modules/**"],
        });
    const crawler = new fdir()
      .withPathSeparator("/")
      .withRelativePaths()
      .withMaxDepth(input.view === "directories" ? scope.depth : scope.depth - 1)
      .withErrors()
      .withAbortSignal(input.signal)
      // A directory is matched against the path it is reported under, which
      // ends in a separator, so a caller's `pkg-*` matches nothing until it
      // becomes `pkg-*/` — an empty answer that reads as "no such package".
      .globWithOptions(
        (scope.glob ?? ["**/*"]).map((pattern) =>
          input.view === "directories" && !pattern.endsWith("/") ? `${pattern}/` : pattern,
        ),
        { dot: scope.includeHidden },
      )
      .filter((file) => file === "." || file.length === 0 || !ignored(file))
      .exclude((name, absolute) => {
        const relative = path.relative(scope.dir, absolute);
        return (
          collapsedDirectories.has(name) ||
          (!scope.includeHidden && name.startsWith(".")) ||
          containingGitSubmodule(path.resolve(absolute), submoduleRoots) !== undefined ||
          (relative !== "." && relative.length > 0 && ignored(`${relative}/`))
        );
      });
    const crawled = await (input.view === "directories"
      ? crawler.withMaxFiles(input.limit + 2).onlyDirs()
      : crawler.withDirs().withMaxFiles(input.limit + 2)
    )
      .crawl(scope.dir)
      .withPromise();
    return crawled.filter((entry) => entry !== "." && entry.length > 0);
  };

  // Keys are agent-written paths: pathe normalizes separators (a Windows
  // agent's `packages\core` would otherwise silently match nothing) and
  // trailing slashes fall away so `docs/` and `docs` are one key.
  const expansions = Object.entries(input.expand ?? {}).map(([key, held]) => ({
    key: path.normalize(key).replace(/\/$/u, ""),
    ...(typeof held === "number" ? { depth: held } : held),
  }));
  for (const expansion of expansions) {
    const target = path.resolve(directory, expansion.key);
    if (target === directory || !isFileInDir(target, directory)) {
      throw new Error(
        `expand keys are directories inside ${input.directory}; "${expansion.key}" is not.`,
      );
    }
  }
  const [baseCrawl, ...expansionCrawls] = await Promise.all([
    crawlScope({
      dir: directory,
      depth: input.depth,
      glob: input.glob,
      includeHidden: input.includeHidden,
      includeIgnored: input.includeIgnored,
    }),
    ...expansions.map((expansion) =>
      crawlScope({
        dir: path.resolve(directory, expansion.key),
        depth: expansion.depth ?? (expansion.glob ? 10 : 1),
        glob: expansion.glob,
        includeHidden: expansion.includeHidden ?? input.includeHidden,
        includeIgnored: expansion.includeIgnored ?? input.includeIgnored,
      }).then((entries) => entries.map((entry) => `${expansion.key}/${entry}`)),
    ),
  ]);
  const crawled = [...new Set([...baseCrawl, ...expansionCrawls.flat()])];

  if (input.view === "directories") {
    const submodules = input.glob
      ? []
      : submoduleRoots.flatMap((submoduleRoot) => {
          if (!isFileInDir(submoduleRoot, directory)) return [];
          const relative = path.relative(directory, submoduleRoot);
          return relative.split("/").length <= input.depth ? [`${relative}/ [submodule]`] : [];
        });
    const directories = [...crawled, ...submodules].sort();
    return {
      entries: directories.slice(0, input.limit).map((name) => ({ name })),
      over: directories.length > input.limit,
      limit: input.limit,
      filtered: input.glob !== undefined,
    };
  }
  const submodulePaths = input.glob
    ? []
    : submoduleRoots.flatMap((submoduleRoot) => {
        if (!isFileInDir(submoduleRoot, directory)) return [];
        const relative = path.relative(directory, submoduleRoot);
        return relative.split("/").length > input.depth ? [] : [`${relative}/`];
      });
  const submodules = new Set(submodulePaths.map((entry) => entry.slice(0, -1)));
  const relatives = [...crawled, ...submodulePaths].sort();
  // One tree, rooted at the asked directory — the shape `tree` and every
  // file explorer have always drawn. The previous form grouped files under
  // per-directory section headers, which read as disconnected fragments:
  // nothing said how `documents/` related to `./`, or what `./` even was.
  type Assembled = { directory: boolean; readonly children: Map<string, Assembled> };
  const assembled: Assembled = { directory: true, children: new Map() };
  for (const entry of relatives.slice(0, input.limit)) {
    const isDirectory = entry.endsWith("/");
    (isDirectory ? entry.slice(0, -1) : entry).split("/").reduce((node, segment, index, all) => {
      const held =
        node.children.get(segment) ??
        node.children
          .set(segment, { directory: index < all.length - 1 || isDirectory, children: new Map() })
          .get(segment)!;
      held.directory ||= index < all.length - 1 || isDirectory;
      return held;
    }, assembled);
  }
  const rows = (node: Assembled, prefix: string): readonly Row[] =>
    [...node.children.entries()]
      .sort(
        ([leftName, left], [rightName, right]) =>
          Number(right.directory) - Number(left.directory) || leftName.localeCompare(rightName),
      )
      .map(([name, child]) => {
        const relative = prefix === "" ? name : `${prefix}/${name}`;
        const label = child.directory
          ? `${name}/${submodules.has(relative) ? " [submodule]" : ""}`
          : name;
        const children = rows(child, relative);
        return children.length > 0 ? { name: label, children } : { name: label };
      });
  const treeRows = rows(assembled, "");
  return {
    entries:
      treeRows.length === 0
        ? []
        : [
            {
              name:
                input.directory === "." ? `${path.basename(realRoot)}/` : `${input.directory}/`,
              children: treeRows,
            },
          ],
    over: relatives.length > input.limit,
    limit: input.limit,
    filtered: input.glob !== undefined,
  };
};
