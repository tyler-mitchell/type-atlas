import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { containingGitSubmodule, findGitSubmoduleRoots } from "@type-atlas/core";
import type { Row } from "atlascii";
import { isFileInDir } from "@volar/language-server/node.js";
import { fdir } from "fdir";
import { isGitIgnored } from "globby";
import * as path from "pathe";

const collapsedDirectories = new Set([".git", "node_modules"]);

/**
 * Build output a fold's price excludes. The count answers "what would I read
 * if I expanded this" — the same reason semble ignores these under a queried
 * root — while the directories themselves still appear in listings.
 */
const buildOutput = new Set(["dist", "build", "out", "coverage"]);

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

/**
 * Resolve and validate the listing's two path arguments. Every failure names
 * the argument that was wrong: `realpath` alone reports a missing or
 * non-directory path as a raw errno naming an absolute path the caller never
 * wrote.
 */
const resolveListingDirectory = async (input: {
  readonly workspace: string;
  readonly directory: string;
}): Promise<{ root: string; directory: string; realRoot: string }> => {
  const root = path.resolve(input.workspace);
  const directory = path.resolve(root, input.directory);
  if (directory !== root && !isFileInDir(directory, root)) {
    throw new Error(`Directory is outside the workspace: ${input.directory}`);
  }
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
  return { root, directory, realRoot };
};

const run = promisify(execFile);

/**
 * One porcelain entry as a plain word. A single letter next to `1.1k loc`
 * reads as magnitude notation — `M` is a million there, not modified — and a
 * bare letter needs a legend where a word needs nothing.
 */
const changeWord = (index: string, worktree: string): string => {
  if (index === "?") return "untracked";
  const both = `${index}${worktree}`;
  if (index === "U" || worktree === "U" || both === "AA" || both === "DD") return "conflicted";
  if (index === "R" || worktree === "R") return "renamed";
  if (index === "D" || worktree === "D") return "deleted";
  if (index === "A") return "added";
  return "modified";
};

/** One file's change state: the word, and what makes it actionable. */
type GitChange = { readonly word: string; readonly detail?: string };

/**
 * What differs from HEAD, keyed by path relative to the listed directory —
 * `git status` fused into the one tree agents orient with, instead of a
 * second flat answer they must join by hand. Outside a repository, or when
 * git itself is unavailable, the map is empty and no row changes.
 *
 * Each change carries the fact that makes its word actionable without a
 * follow-up git call: a rename names its origin (`renamed from posting.ts` —
 * the bare word forced exactly that follow-up), and a tracked change carries
 * its size (`modified +2 -1`), pricing the change the way `loc` prices the
 * read. Untracked files have no baseline and conflicts no meaningful diff,
 * so those words stand alone.
 */
const gitChanges = async (directory: string): Promise<ReadonlyMap<string, GitChange>> => {
  const toplevel = await run("git", ["-C", directory, "rev-parse", "--show-toplevel"])
    .then(({ stdout }) => path.normalize(stdout.trim()))
    .catch(() => undefined);
  if (toplevel === undefined) return new Map();
  const [{ stdout }, numstat] = await Promise.all([
    run("git", ["-C", directory, "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      maxBuffer: 64 * 1024 * 1024,
    }).catch(() => ({ stdout: "" })),
    // Index and worktree against HEAD in one pass; --no-renames keeps every
    // record `added TAB removed TAB path`, since renames render their origin
    // rather than their size.
    run("git", ["-C", directory, "diff", "HEAD", "--numstat", "--no-renames", "-z"], {
      maxBuffer: 64 * 1024 * 1024,
    })
      .then((result) => result.stdout)
      .catch(() => ""),
  ]);
  const magnitudes = new Map(
    numstat
      .split("\0")
      .map((record) => record.split("\t"))
      .filter((parts): parts is [string, string, string] => parts.length === 3)
      .map(([added, removed, file]) => [
        file,
        [
          added !== "-" && added !== "0" ? `+${added}` : undefined,
          removed !== "-" && removed !== "0" ? `-${removed}` : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      ]),
  );
  const fields = stdout.split("\0");
  const changes = new Map<string, GitChange>();
  for (let at = 0; at < fields.length; at += 1) {
    const field = fields[at] ?? "";
    if (field.length < 4) continue;
    const [index, worktree] = [field[0] ?? " ", field[1] ?? " "];
    // A rename carries its origin as the next NUL field; the letter belongs
    // to the path the file lives at now, the way VS Code shows it.
    const renamed = index === "R" || index === "C" || worktree === "R" || worktree === "C";
    const origin = renamed ? fields[at + 1] : undefined;
    if (renamed) at += 1;
    const absolute = path.join(toplevel, field.slice(3));
    if (absolute !== directory && !isFileInDir(absolute, directory)) continue;
    const relative = path.relative(directory, absolute);
    const word = changeWord(index, worktree);
    const size = magnitudes.get(field.slice(3));
    // A same-directory rename names its origin by basename — the row's own
    // position already says the directory; a move across directories keeps
    // the listing-relative path, because the directory IS the change.
    const originListed =
      origin === undefined ? undefined : path.relative(directory, path.join(toplevel, origin));
    const detail =
      word === "renamed" && originListed !== undefined
        ? `from ${
            path.dirname(originListed) === path.dirname(relative)
              ? path.basename(originListed)
              : originListed
          }`
        : (word === "modified" || word === "added" || word === "deleted") && size
          ? size
          : undefined;
    changes.set(relative, { word, detail });
  }
  return changes;
};

/** One node per path segment; a fold renders where children were not kept. */
type Assembled = { directory: boolean; readonly children: Map<string, Assembled> };

/**
 * Assemble the one tree, enforcing the completeness rule for every way the
 * bound can cut: no directory may render as complete while the limit dropped
 * any of its contents. It wore three costumes before one rule replaced them —
 * core-time/ as a lone README (base crawl truncated mid-subtree), packages/
 * as 14 of 25 packages (an expansion sliced away wholesale), graph-grammar/
 * as two files (an expansion sliced mid-record). A dropped directory stubs
 * itself as a fold; a dropped file folds its whole parent; either way the
 * fold's count then prices what the bound could not show.
 *
 * `renderedFiles` is what the tree actually shows as individual files — the
 * set later stages may price without outgrowing the bound.
 */
const assembleTree = (
  relatives: readonly string[],
  limit: number,
): { assembled: Assembled; renderedFiles: readonly string[] } => {
  const kept = relatives.slice(0, limit);
  const keptDirs = new Set(kept.filter((entry) => entry.endsWith("/")));
  const stubs = new Set<string>();
  const foldedParents = new Set<string>();
  for (const entry of relatives.slice(limit)) {
    const segments = (entry.endsWith("/") ? entry.slice(0, -1) : entry).split("/");
    if (entry.endsWith("/")) {
      const spine = segments.map((_, held) => `${segments.slice(0, held + 1).join("/")}/`);
      const nearest = spine.find((ancestor) => !keptDirs.has(ancestor));
      if (nearest !== undefined) stubs.add(nearest);
    } else if (segments.length > 1) {
      foldedParents.add(`${segments.slice(0, -1).join("/")}/`);
    }
  }
  const insideFoldedParent = (entry: string) =>
    [...foldedParents].some((parent) => entry !== parent && entry.startsWith(parent));
  const assembled: Assembled = { directory: true, children: new Map() };
  for (const entry of [
    ...kept.filter((entry) => !insideFoldedParent(entry)),
    ...[...stubs].filter((entry) => !insideFoldedParent(entry)),
    ...foldedParents,
  ]) {
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
  return {
    assembled,
    renderedFiles: kept.filter((entry) => !entry.endsWith("/") && !insideFoldedParent(entry)),
  };
};

/** Every directory the tree renders folded — childless here, contents elsewhere. */
const foldedDirectories = (
  assembled: Assembled,
  submodules: ReadonlySet<string>,
): readonly string[] => {
  const folded: string[] = [];
  const collect = (node: Assembled, prefix: string): void => {
    for (const [name, child] of node.children) {
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      if (child.directory && child.children.size === 0 && !submodules.has(relative)) {
        folded.push(relative);
      }
      collect(child, relative);
    }
  };
  collect(assembled, "");
  return folded;
};

const newlineCount = (source: Buffer): number => {
  let count = 0;
  for (let at = source.indexOf(10); at !== -1; at = source.indexOf(10, at + 1)) count += 1;
  return count;
};

/**
 * Rounded the way a reader weighs them: exact below a thousand, compact
 * above — `1.3k loc`, not `1300 loc`. The number is a price, not a measurement.
 */
const compactLines = (lines: number): string => {
  if (lines < 1000) return `${lines}`;
  const scaled = lines < 1_000_000 ? lines / 1000 : lines / 1_000_000;
  const unit = lines < 1_000_000 ? "k" : "m";
  return `${(Math.round(scaled * 10) / 10).toString().replace(/\.0$/u, "")}${unit}`;
};

/**
 * A file's line count is the price of reading it — the same budgeting the
 * folded counts give directories, one level finer. Only rendered files are
 * read, so the limit that bounds the tree bounds this too; a binary or an
 * unreadable path stays unpriced rather than carrying a number that lies.
 */
const fileLinePrices = async (
  base: string,
  files: readonly string[],
): Promise<ReadonlyMap<string, number>> => {
  const prices = new Map<string, number>();
  for (let held = 0; held < files.length; held += 64) {
    await Promise.all(
      files.slice(held, held + 64).map(async (relative) => {
        const source = await readFile(path.resolve(base, relative)).catch(() => undefined);
        if (source === undefined || source.includes(0)) return;
        prices.set(
          relative,
          source.length === 0 ? 0 : newlineCount(source) + (source.at(-1) === 10 ? 0 : 1),
        );
      }),
    );
  }
  return prices;
};

/** The assembled trie as atlascii rows, directories first, labels supplied by the caller. */
const renderRows = (
  node: Assembled,
  prefix: string,
  label: (entry: {
    readonly relative: string;
    readonly name: string;
    readonly directory: boolean;
  }) => string,
): readonly Row[] =>
  [...node.children.entries()]
    .sort(
      ([leftName, left], [rightName, right]) =>
        Number(right.directory) - Number(left.directory) || leftName.localeCompare(rightName),
    )
    .map(([name, child]) => {
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      const rendered = label({ relative, name, directory: child.directory });
      const children = renderRows(child, relative, label);
      return children.length > 0 ? { name: rendered, children } : { name: rendered };
    });

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
  /** Suffix each rendered file with its line count — `· 244 loc`. */
  readonly loc: boolean;
  /** Mark git changes in plain words — `· modified` on files, `· N changed` on directories. */
  readonly git: boolean;
  readonly signal: AbortSignal;
  readonly view: "directories" | "files";
}): Promise<WorkspaceListing> => {
  const { root, directory, realRoot } = await resolveListingDirectory(input);
  const changesHeld = input.git
    ? gitChanges(directory)
    : Promise.resolve(new Map<string, GitChange>());
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
  // One gitignore matcher, rooted at the listing directory: parent gitignores
  // govern every subtree, so scope-relative paths prefix before matching and
  // no crawl or count builds its own walk of the ignore files.
  const ignored = input.includeIgnored
    ? () => false
    : await isGitIgnored({
        cwd: directory,
        followSymbolicLinks: false,
        ignore: ["**/.git/**", "**/node_modules/**"],
      });
  // One crawler builder for every ask this listing makes — base, expansions,
  // and fold counts differ only in root, depth, glob, and finisher.
  const scoped = (scope: {
    readonly at: string;
    readonly depth?: number;
    readonly glob?: readonly string[] | undefined;
    readonly includeHidden?: boolean;
    readonly includeIgnored?: boolean;
    readonly excludeBuildOutput?: boolean;
  }) => {
    const hidden = scope.includeHidden ?? input.includeHidden;
    const skip = (scope.includeIgnored ?? input.includeIgnored) ? () => false : ignored;
    const dir = path.resolve(directory, scope.at);
    const within = (relative: string) => (scope.at === "." ? relative : `${scope.at}/${relative}`);
    const depthLimited =
      scope.depth === undefined
        ? new fdir()
        : new fdir().withMaxDepth(input.view === "directories" ? scope.depth : scope.depth - 1);
    return {
      dir,
      crawler: depthLimited
        .withPathSeparator("/")
        .withRelativePaths()
        .withErrors()
        .withAbortSignal(input.signal)
        // A directory is matched against the path it is reported under, which
        // ends in a separator, so a caller's `pkg-*` matches nothing until it
        // becomes `pkg-*/` — an empty answer that reads as "no such package".
        .globWithOptions(
          (scope.glob ?? ["**/*"]).map((pattern) =>
            input.view === "directories" && !pattern.endsWith("/") ? `${pattern}/` : pattern,
          ),
          { dot: hidden },
        )
        .filter((file) => file === "." || file.length === 0 || !skip(within(file)))
        .exclude((name, absolute) => {
          const relative = path.relative(directory, absolute);
          return (
            collapsedDirectories.has(name) ||
            (scope.excludeBuildOutput === true && buildOutput.has(name)) ||
            (!hidden && name.startsWith(".")) ||
            containingGitSubmodule(path.resolve(absolute), submoduleRoots) !== undefined ||
            (relative !== "." && relative.length > 0 && skip(`${relative}/`))
          );
        }),
    };
  };
  const crawlScope = async (scope: Parameters<typeof scoped>[0]): Promise<readonly string[]> => {
    const { dir, crawler } = scoped(scope);
    const crawled = await (
      input.view === "directories"
        ? crawler.withMaxFiles(input.limit + 2).onlyDirs()
        : crawler.withDirs().withMaxFiles(input.limit + 2)
    )
      .crawl(dir)
      .withPromise();
    return crawled.filter((entry) => entry !== "." && entry.length > 0);
  };

  // Keys are agent-written paths or globs: pathe normalizes separators (a
  // Windows agent's `packages\core` would otherwise silently match nothing),
  // trailing slashes fall away so `docs/` and `docs` are one key, and a
  // pattern key resolves to every directory it matches — `"packages/*": 1`
  // opens every package one level, which is the monorepo-map call the record
  // form exists for.
  const expansions = (
    await Promise.all(
      Object.entries(input.expand ?? {}).map(async ([raw, held]) => {
        const key = path.normalize(raw).replace(/\/$/u, "");
        const options = typeof held === "number" ? { depth: held } : held;
        if (!/[*?[{(!]/u.test(key)) return [{ key, ...options }];
        const { dir, crawler } = scoped({
          at: ".",
          depth: key.split("/").length + 1,
          glob: [`${key}/`],
        });
        const matched = await crawler.onlyDirs().crawl(dir).withPromise();
        return matched
          .filter((entry) => entry !== "." && entry.length > 0)
          .map((entry) => ({ key: entry.replace(/\/$/u, ""), ...options }));
      }),
    )
  ).flat();
  for (const expansion of expansions) {
    const target = path.resolve(directory, expansion.key);
    if (target === directory || !isFileInDir(target, directory)) {
      throw new Error(
        `expand keys are directories inside ${input.directory}; "${expansion.key}" is not.`,
      );
    }
    // Named directly (a pattern key only ever resolves to real directories),
    // so a wrong key answers about the argument — a raw errno would name an
    // absolute path with a trailing slash the caller never wrote.
    if (!(await stat(target).catch(() => undefined))?.isDirectory()) {
      throw new Error(
        `No directory at "${expansion.key}" under ${input.directory}. An expand key is a directory, or a pattern matching directories.`,
      );
    }
  }
  const [baseCrawl, ...expansionCrawls] = await Promise.all([
    crawlScope({ at: ".", depth: input.depth, glob: input.glob }),
    ...expansions.map((expansion) =>
      crawlScope({
        at: expansion.key,
        depth: expansion.depth ?? (expansion.glob ? 10 : 1),
        glob: expansion.glob,
        includeHidden: expansion.includeHidden,
        includeIgnored: expansion.includeIgnored,
      }).then((entries) => entries.map((entry) => `${expansion.key}/${entry}`)),
    ),
  ]);
  const crawled = [...new Set([...baseCrawl, ...expansionCrawls.flat()])];
  const changed = await changesHeld;
  const fileMark = (relative: string): string => {
    const change = changed.get(relative);
    if (change === undefined) return "";
    return change.detail === undefined ? ` · ${change.word}` : ` · ${change.word} ${change.detail}`;
  };
  // Plain words, not a glyph: an editor's change-dot is pixels a model has
  // rarely read as text, while "3 changed" is self-describing on first
  // contact and says how much dirt a fold hides.
  const directoryMark = (relative: string): string => {
    const prefix = `${relative}/`;
    const count = [...changed.keys()].filter(
      (key) => key === relative || key.startsWith(prefix),
    ).length;
    return count === 0 ? "" : ` · ${count} changed`;
  };

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
      entries: directories.slice(0, input.limit).map((name) => ({
        name: `${name}${directoryMark(name.replace(/ \[submodule\]$/u, "").replace(/\/$/u, ""))}`,
      })),
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
  // A deleted file exists in git's answer and nowhere on disk. It renders as
  // a ghost row carrying `· deleted`, the way editors keep deletions visible
  // — omitting it would make the tree claim a file count the repository
  // disputes. Ghosts follow the base depth and stay out of filtered views.
  const crawledSet = new Set(crawled);
  const ghosts =
    input.glob === undefined
      ? [...changed]
          .filter(
            ([relative, change]) =>
              change.word === "deleted" &&
              relative.split("/").length <= input.depth &&
              !crawledSet.has(relative),
          )
          .map(([relative]) => relative)
      : [];
  // One tree, rooted at the asked directory — the shape `tree` and every
  // file explorer have always drawn. The previous form grouped files under
  // per-directory section headers, which read as disconnected fragments:
  // nothing said how `documents/` related to `./`, or what `./` even was.
  const relatives = [...crawled, ...ghosts, ...submodulePaths].sort();
  const { assembled, renderedFiles } = assembleTree(relatives, input.limit);
  // A folded directory states what it holds — `documents/ · 34 files` — so a
  // reader prices expanding it without a second call. fdir's own counter
  // (`onlyCounts`), under the same ignore rules, no paths materialized;
  // skipped wholesale past a bound so a huge shallow listing stays cheap.
  // Shallowest folds price first when there are more than the counting
  // budget: the map's top levels are what a reader weighs, and an
  // all-or-nothing bound once erased every price the moment stubs pushed
  // the fold count past it.
  const counted = new Map(
    await Promise.all(
      [...foldedDirectories(assembled, submodules)]
        .filter((relative) => !buildOutput.has(relative.split("/").pop() ?? ""))
        .sort((left, right) => left.split("/").length - right.split("/").length)
        .slice(0, 60)
        .map(async (relative) => {
          const { dir, crawler } = scoped({ at: relative, excludeBuildOutput: true });
          return [relative, await crawler.onlyCounts().crawl(dir).withPromise()] as const;
        }),
    ),
  );
  const lineCounts = input.loc
    ? await fileLinePrices(directory, renderedFiles)
    : new Map<string, number>();
  const holdings = (relative: string): string => {
    const counts = counted.get(relative);
    if (!counts || (counts.files === 0 && counts.directories <= 1)) return "";
    return counts.files > 0
      ? ` · ${counts.files} ${counts.files === 1 ? "file" : "files"}`
      : ` · ${counts.directories - 1} ${counts.directories === 2 ? "dir" : "dirs"}`;
  };
  const price = (relative: string): string => {
    const lines = lineCounts.get(relative);
    return lines === undefined ? "" : ` · ${compactLines(lines)} loc`;
  };
  const treeRows = renderRows(assembled, "", ({ relative, name, directory: isDirectory }) =>
    isDirectory
      ? `${name}/${submodules.has(relative) ? " [submodule]" : holdings(relative)}${directoryMark(relative)}`
      : `${name}${price(relative)}${fileMark(relative)}`,
  );
  return {
    entries:
      treeRows.length === 0
        ? []
        : [
            {
              name: input.directory === "." ? `${path.basename(realRoot)}/` : `${input.directory}/`,
              children: treeRows,
            },
          ],
    over: relatives.length > input.limit,
    limit: input.limit,
    filtered: input.glob !== undefined,
  };
};
