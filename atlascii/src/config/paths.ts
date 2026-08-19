/**
 * Which of three renderings a location takes.
 *
 * `workspace` is the default because a path is read against the root the caller
 * named, and repeating that root on every line costs a reader more than it
 * tells. `absolute` is for handing a path to something outside this answer — a
 * shell, an editor, another tool — where a relative path means nothing.
 * `project` is for working inside one package of a monorepo, where the package
 * is the frame of reference and the repository root is noise.
 *
 * Its own file, beside the other namespaces, so the module that renders a path
 * can name the style without importing the resolver that reads it.
 */
export const pathStyles = ["workspace", "absolute", "project"] as const;

export type PathStyle = (typeof pathStyles)[number];

/**
 * Directory names that mean "installed here by a package manager".
 *
 * A file under one of these is named by its package-relative path rather than
 * by where the manager put it: pnpm's store spends ninety characters on a
 * content address, so `Array.reduce` arrives as
 * `…/node_modules/.pnpm/typescript-native-bridge@6.0.3-…/node_modules/typescript-native-bridge/lib/lib.es5.d.ts`
 * to say `lib.es5.d.ts`.
 *
 * A list rather than a constant because the rule is language-specific and this
 * library is not. `node_modules` is JavaScript's answer; Python installs to
 * `site-packages`, Rust to a `registry` under Cargo's home, Go to `pkg/mod`.
 * Adding a language should add a name here, never edit the function that
 * renders a path.
 */
export type VendorDirectories = readonly string[];

export const defaultVendorDirectories: VendorDirectories = [
  "node_modules",
  "site-packages",
  "pkg/mod",
];
