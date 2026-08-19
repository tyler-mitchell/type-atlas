/**
 * How a location is written down.
 *
 * A path has an identity — the file it names — and a rendering, and only the
 * second is a presentation choice. Which one a reader gets is configurable for
 * the same reason the nesting guide is: the information is identical and the
 * form is not, and a consumer should decide once rather than per call site.
 *
 * The arithmetic is `pathe`'s. Every part of this was once hand-rolled string
 * surgery, and each piece of it was wrong somewhere: slicing `file://` off a
 * URI leaves `/c:/src/app.ts` on Windows, where the drive letter needs the
 * slash gone; comparing a root by `startsWith` matches `/repo-backup` against
 * `/repo`; and normalising separators with a regex is a `pathe` call spelled
 * out. `pathe` returns POSIX separators on every platform, which is what a
 * terminal answer should show whatever the host wrote it with.
 */
import { fileURLToPath } from "node:url";
import { isAbsolute, normalize, relative } from "pathe";
import { resolve } from "../config/index.ts";
import type { PathStyle, VendorDirectories } from "../config/paths.ts";

/** A path with forward slashes, whatever the platform wrote it with. */
export const slash = (path: string) => normalize(path);

const fileScheme = "file://";

/**
 * What a vendored file is called: its path inside the package that ships it.
 *
 * Separate from the styles below because it answers a different question. The
 * style asks which root a path is measured from; this asks whether the file has
 * a root of its own — a package the reader knows by name, sitting somewhere no
 * reader chose. Conflating them is what made adding a language mean editing the
 * renderer.
 */
const withinPackage = (file: string, vendored: VendorDirectories) =>
  vendored.reduce<string | undefined>((found, directory) => {
    if (found !== undefined) return found;
    const marker = `/${directory}/`;
    const at = file.lastIndexOf(marker);
    // The *last* marker: a package manager may nest one inside another, and
    // everything before the innermost is where it was put rather than what it
    // is. pnpm's store spends ninety characters on a content address.
    return at < 0 ? undefined : file.slice(at + marker.length);
  }, undefined);

export const displayPath = (
  uri: string,
  workspaceRoot: string,
  options?: { readonly style?: PathStyle },
): string => {
  // Not every document has a file behind it. An `untitled:` buffer is named by
  // its URI and has no path to render, so it is passed through as it arrived.
  if (!uri.startsWith(fileScheme)) return uri;
  const file = normalize(fileURLToPath(uri));
  const settings = resolve();
  // What this call named, else what the host chose for the process.
  const style = options?.style ?? settings.paths;
  // Absolute means absolute, including inside a package: a caller asking for a
  // path to hand to something else needs the real one, not a name that resolves
  // only against a package manager's layout.
  if (style === "absolute") return file;
  const packaged = withinPackage(file, settings.vendored);
  if (packaged !== undefined) return packaged;
  // A project is found on disk, which this library does not read, so the host
  // answers. A file belonging to no project it knows falls to the workspace —
  // the same answer the default style gives, which is the right one for a file
  // that has no nearer frame of reference.
  const project = style === "project" ? settings.projectRootFor?.(file) : undefined;
  const from = project ?? workspaceRoot;
  const within = relative(normalize(from), file);
  // A file outside the root it was measured against renders absolute rather
  // than as a climb out of it: `../../../other/repo/src/app.ts` states a
  // relationship the reader did not ask about and cannot use.
  //
  // Two ways to be outside, and both must be caught. A climb says so with `..`;
  // a different Windows drive cannot be reached by climbing at all, and
  // `relative` answers it with an absolute path rather than a relative one.
  return within === "" || within.startsWith("..") || isAbsolute(within) ? file : within;
};
