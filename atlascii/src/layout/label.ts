/**
 * Labels: a name set apart from what follows it.
 *
 * Vitest brackets a project name (`|node|`, `|browser|`) so a reader scanning
 * interleaved output from several projects can tell them apart at a glance.
 * The brackets are what survive without colour — Vitest reaches for a coloured
 * background first and falls back to exactly this.
 */
export const label = (input: { readonly name: string; readonly message?: string }) =>
  input.message === undefined ? `|${input.name}|` : `|${input.name}| ${input.message}`;

/**
 * Aligns a set of labels to a shared width, so their values share a column.
 *
 * The width comes from the longest label given, not from a constant, which is
 * what a fixed column cannot do for labels a caller chooses at runtime.
 */
export const labelPrinter = (labels: readonly string[]) => {
  const longest = labels.reduce((widest, name) => Math.max(widest, name.length), 0);
  return (name: string) => `${name}: ${" ".repeat(longest - name.length)}`;
};
