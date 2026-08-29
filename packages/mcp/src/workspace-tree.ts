import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { containingGitSubmodule, findGitSubmoduleRoots } from "@type-atlas/core";
import type { Row } from "@type-atlas/atlascii";
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
  /**
   * Every file the tree rendered, workspace-relative — the same listing as a
   * list, so a caller can hand it straight to another tool rather than parsing
   * paths back out of drawn rows.
   */
  readonly files: readonly string[];
  readonly filtered: boolean;
  /** The listing was the working-tree delta, so an empty answer means clean. */
  readonly changedOnly: boolean;
};

/** Per-subtree overrides for an expanded directory, each an existing option scoped down. */
export type WorkspaceExpansion = {
  readonly depth?: number;
  readonly glob?: readonly string[];
  readonly includeHidden?: boolean;
  readonly includeIgnored?: boolean;
  /** Entries this subtree may contribute before the rest elides to `… N more`. */
  readonly limit?: number;
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
 * One porcelain entry as VS Code's file-explorer badge letter: `M` modified,
 * `A` added, `D` deleted, `R` renamed, `U` untracked, `C` conflicted.
 *
 * Two letter alphabets exist. Git's own short format (git-status(1)) writes
 * `??` for untracked and `U` for unmerged; VS Code's explorer writes `U` for
 * untracked and `C` for conflicted, and that variant is the one agents have
 * met beside tree rows — in the most-used editor, its forks, and the tools
 * that copy its badges. This surface is an explorer-shaped tree, so it
 * speaks the explorer's alphabet; the porcelain XY pair collapses to the one
 * letter an orienting reader acts on.
 */
const changeCode = (index: string, worktree: string): string => {
  if (index === "?") return "U";
  const both = `${index}${worktree}`;
  if (index === "U" || worktree === "U" || both === "AA" || both === "DD") return "C";
  if (index === "R" || worktree === "R") return "R";
  if (index === "D" || worktree === "D") return "D";
  if (index === "A") return "A";
  return "M";
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
    const word = changeCode(index, worktree);
    const size = magnitudes.get(field.slice(3));
    // A same-directory rename names its origin by basename — the row's own
    // position already says the directory; a move across directories keeps
    // the listing-relative path, because the directory IS the change. The
    // arrow is git's own rename grammar (`orig -> path`), pointed at the row
    // that carries it: `R dedupe.ts →`.
    const originListed =
      origin === undefined ? undefined : path.relative(directory, path.join(toplevel, origin));
    const detail =
      word === "R" && originListed !== undefined
        ? `${
            path.dirname(originListed) === path.dirname(relative)
              ? path.basename(originListed)
              : originListed
          } →`
        : (word === "M" || word === "A" || word === "D") && size
          ? size
          : undefined;
    changes.set(relative, { word, detail });
  }
  return changes;
};

/** One node per path segment; a fold renders where children were not kept. */
type Assembled = { directory: boolean; readonly children: Map<string, Assembled> };

/**
 * Assemble the one tree, enforcing the completeness rule for every way a
 * bound can cut: no directory may render as complete while a limit dropped
 * any of its contents. A dropped directory stubs itself as a fold, priced
 * later with its counts; a dropped file leaves an `… N more` elision row on
 * the parent that kept the rest of its children — the parent stays open and
 * partial, where the earlier rule folded it whole and hid even the entries
 * the bound had already paid for.
 *
 * `forcedDrop` carries entries cut by a narrower bound than the global one —
 * a per-expansion `limit` — so every bound converges on this one
 * attribution. `renderedFiles` is what the tree shows as individual files —
 * the set later stages may price without outgrowing the bound.
 */
const assembleTree = (
  relatives: readonly string[],
  limit: number,
  forcedDrop: ReadonlySet<string> = new Set(),
): {
  assembled: Assembled;
  renderedFiles: readonly string[];
  /** Directories owed an `… N more` row ("" is the listing root), with the count they hide. */
  elided: ReadonlyMap<string, number>;
} => {
  const kept = relatives.filter((entry) => !forcedDrop.has(entry)).slice(0, limit);
  const keptSet = new Set(kept);
  // A directory "renders open" when it was kept as an entry OR any kept
  // entry lies beneath it — a glob listing never crawls directories as
  // entries, so without the ancestor half, a directory with kept children
  // would swallow its dropped files with neither a stub nor an elision.
  const openDirs = new Set(
    kept.flatMap((entry) => {
      const segments = (entry.endsWith("/") ? entry.slice(0, -1) : entry).split("/");
      const upTo = entry.endsWith("/") ? segments.length : segments.length - 1;
      return [
        ...(entry.endsWith("/") ? [entry] : []),
        ...segments.slice(0, upTo).map((_, held) => `${segments.slice(0, held + 1).join("/")}/`),
      ];
    }),
  );
  const stubs = new Set<string>();
  const elided = new Map<string, number>();
  for (const entry of relatives) {
    if (keptSet.has(entry)) continue;
    const segments = (entry.endsWith("/") ? entry.slice(0, -1) : entry).split("/");
    const ancestors = (below: number) =>
      segments.slice(0, below).map((_, held) => `${segments.slice(0, held + 1).join("/")}/`);
    if (entry.endsWith("/")) {
      const nearest = ancestors(segments.length).find((ancestor) => !openDirs.has(ancestor));
      if (nearest !== undefined) stubs.add(nearest);
      continue;
    }
    const parent = segments.length > 1 ? `${segments.slice(0, -1).join("/")}/` : "";
    if (parent === "" || openDirs.has(parent)) {
      // The parent keeps its shown children and gains an elision row — it
      // used to fold whole, which hid even the entries the bound had paid
      // for. The count is exact over what the crawls saw; a crawl that
      // filled its lookahead drops the root count rather than lying.
      elided.set(parent, (elided.get(parent) ?? 0) + 1);
    } else {
      // The parent fell too: its stub's fold count prices this file.
      const nearest = ancestors(segments.length - 1).find((ancestor) => !openDirs.has(ancestor));
      if (nearest !== undefined) stubs.add(nearest);
    }
  }
  const assembled: Assembled = { directory: true, children: new Map() };
  for (const entry of [...kept, ...stubs]) {
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
    renderedFiles: kept.filter((entry) => !entry.endsWith("/")),
    elided,
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

/**
 * The assembled trie as atlascii rows, directories first, labels supplied by
 * the caller. A directory owed an elision closes with `… N more` as its last
 * row, so a partially shown directory can never read as complete.
 */
const renderRows = (
  node: Assembled,
  prefix: string,
  label: (entry: {
    readonly relative: string;
    readonly name: string;
    readonly directory: boolean;
  }) => string,
  elided: ReadonlyMap<string, string>,
): readonly Row[] => {
  const rows = [...node.children.entries()]
    .sort(
      ([leftName, left], [rightName, right]) =>
        Number(right.directory) - Number(left.directory) || leftName.localeCompare(rightName),
    )
    .map(([name, child]) => {
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      const rendered = label({ relative, name, directory: child.directory });
      const children = renderRows(child, relative, label, elided);
      return children.length > 0 ? { name: rendered, children } : { name: rendered };
    });
  const hidden = elided.get(prefix === "" ? "" : `${prefix}/`);
  return hidden === undefined ? rows : [...rows, { name: hidden }];
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
  /** Suffix each rendered file with its line count — `· 244 loc`. */
  readonly loc: boolean;
  /** Mark git changes — badge letters (`· M +2 -1`) on files, `· N changed` on directories. */
  readonly git: boolean;
  /** Only paths git reports changed — the whole working-tree delta, any depth. */
  readonly changed: boolean;
  readonly signal: AbortSignal;
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
  const changed = await changesHeld;
  const fileMark = (relative: string): string => {
    const change = changed.get(relative);
    if (change === undefined) return "";
    return change.detail === undefined ? ` · ${change.word}` : ` · ${change.word} ${change.detail}`;
  };
  // A count in words rather than a glyph: an editor's change-dot is pixels a
  // model has rarely read as text, while "3 changed" is self-describing on
  // first contact and says how much dirt a fold hides.
  const directoryMark = (relative: string): string => {
    const prefix = `${relative}/`;
    const count = [...changed.keys()].filter(
      (key) => key === relative || key.startsWith(prefix),
    ).length;
    return count === 0 ? "" : ` · ${count} changed`;
  };
  // The crawl works relative to the listed directory; every other tool takes
  // workspace-relative paths, so the list this reports speaks that language.
  const workspaceRelative = (relative: string) =>
    input.directory === "." ? relative : path.join(input.directory, relative);

  if (input.changed) {
    // The working-tree delta as one tree: exactly the changed paths, at any
    // depth, without the hundreds of clean rows around them. Depth, glob,
    // and expand describe a structural walk and do not apply here — the walk
    // is git's own answer, which already carries deletions as ghost rows.
    const relatives = [...changed.keys()].sort();
    const { assembled, renderedFiles, elided } = assembleTree(relatives, input.limit);
    const lineCounts = input.loc
      ? await fileLinePrices(directory, renderedFiles)
      : new Map<string, number>();
    const treeRows = renderRows(
      assembled,
      "",
      ({ relative, name, directory: isDirectory }) => {
        if (isDirectory) return `${name}/${directoryMark(relative)}`;
        const lines = lineCounts.get(relative);
        return `${name}${lines === undefined ? "" : ` · ${compactLines(lines)} loc`}${fileMark(relative)}`;
      },
      new Map([...elided].map(([parent, count]) => [parent, `… ${count} more`] as const)),
    );
    return {
      files: renderedFiles.map(workspaceRelative),
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
      filtered: false,
      changedOnly: true,
    };
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
      scope.depth === undefined ? new fdir() : new fdir().withMaxDepth(scope.depth - 1);
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
        .globWithOptions([...(scope.glob ?? ["**/*"])], { dot: hidden })
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
  // Crawls look ahead of the limit so `… N more` rows carry exact counts for
  // any ordinary overshoot; a crawl that fills the whole lookahead has an
  // uncountable remainder, and the root's elision drops its number rather
  // than stating one that lies.
  const lookahead = input.limit + 500;
  const crawlScope = async (scope: Parameters<typeof scoped>[0]): Promise<readonly string[]> => {
    const { dir, crawler } = scoped(scope);
    const crawled = await crawler.withDirs().withMaxFiles(lookahead).crawl(dir).withPromise();
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
      }).then((entries) => {
        const prefixed = entries.map((entry) => `${expansion.key}/${entry}`).sort();
        // A subtree's own budget: entries past it are cut here and elide on
        // their parents through the same attribution the global bound uses.
        return expansion.limit === undefined
          ? { entries: prefixed, overflow: [] as string[] }
          : { entries: prefixed, overflow: prefixed.slice(expansion.limit) };
      }),
    ),
  ]);
  const crawled = [
    ...new Set([...baseCrawl, ...expansionCrawls.flatMap(({ entries }) => entries)]),
  ];
  const forcedDrop = new Set(expansionCrawls.flatMap(({ overflow }) => overflow));
  const lookaheadFull =
    baseCrawl.length >= lookahead ||
    expansionCrawls.some(({ entries }) => entries.length >= lookahead);

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
              change.word === "D" &&
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
  const { assembled, renderedFiles, elided } = assembleTree(relatives, input.limit, forcedDrop);
  const elisionRows = new Map<string, string>(
    [...elided].map(([parent, count]) => [parent, `… ${count} more`]),
  );
  if (lookaheadFull) elisionRows.set("", "… more");
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
          // The fold's count answers under the same glob as the listing —
          // a ts-only listing once priced a fold at 7 files where expanding
          // it under the same pattern would have shown 4.
          const { dir, crawler } = scoped({
            at: relative,
            excludeBuildOutput: true,
            glob: input.glob,
          });
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
  const treeRows = renderRows(
    assembled,
    "",
    ({ relative, name, directory: isDirectory }) =>
      isDirectory
        ? `${name}/${submodules.has(relative) ? " [submodule]" : holdings(relative)}${directoryMark(relative)}`
        : `${name}${price(relative)}${fileMark(relative)}`,
    elisionRows,
  );
  return {
    files: renderedFiles.map(workspaceRelative),
    entries:
      treeRows.length === 0
        ? []
        : [
            {
              name: input.directory === "." ? `${path.basename(realRoot)}/` : `${input.directory}/`,
              children: treeRows,
            },
          ],
    filtered: input.glob !== undefined,
    changedOnly: false,
  };
};
