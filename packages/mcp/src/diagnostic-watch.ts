import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { createTypeAtlas, renderDocument, type VolarWorkspacePool } from "@type-atlas/core";
import { displayPath } from "atlascii";

/**
 * How long the workspace must stop changing before diagnostics are read.
 *
 * A write is not an edit. Saving nine files during a rename produces nine
 * bursts and hundreds of transient errors that resolve on the last write, so
 * the watch waits for the workspace to settle instead of reporting each
 * intermediate state.
 */
const settleDelay = 1_000;

/** Distinguishes the same relative path watched under two different roots. */
const watchKey = (workspace: string, file: string): string => `${workspace} ${file}`;

/**
 * Reports a file's diagnostics again whenever they change.
 *
 * The trigger is any change in the workspace, not a change to the watched file:
 * a file's diagnostics most often change because a *different* file was edited,
 * and a watch bound to one path would stay silent through exactly the case an
 * agent most needs to hear about — editing one module and breaking another.
 *
 * Each settled change re-reads the file through the language server, so what is
 * published is the language server's own current answer rather than a guess
 * derived from the edit.
 */
export const createDiagnosticWatch = (
  workspaces: VolarWorkspacePool,
  publish: (change: { readonly workspace: string; readonly file: string }) => void,
) => {
  const active = new Map<string, () => void>();
  const reports = new Map<string, string>();

  const read = async (
    workspace: string,
    filePath: string,
    signal: AbortSignal,
  ): Promise<string> => {
    const held = await workspaces.get(workspace);
    const { textDocument, result } = await createTypeAtlas(held).diagnostics({
      file: filePath,
      signal,
    });
    const file = displayPath(textDocument.uri, workspace);
    const items = result && "items" in result ? result.items : [];
    const rendered = await renderDocument({
      document: "diagnostic-context.mdoc",
      variables: { verbose: true, groups: [{ file, problems: items }] },
    });
    return rendered.text;
  };

  const stop = (key: string): void => {
    active.get(key)?.();
    active.delete(key);
  };

  return {
    /** The most recent report for a watched file, for a client reading it back. */
    latest: (workspace: string, file: string): string | undefined =>
      reports.get(watchKey(workspace, file)),

    watching: (): readonly string[] => [...active.keys()],

    dispose: (): void => {
      // stop() deletes from `active`; iterating live keys() while deleting
      // skips entries, so the copy is load-bearing.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const key of [...active.keys()]) stop(key);
      reports.clear();
    },

    start: async (input: {
      readonly workspace: string;
      readonly file: string;
      readonly durationSeconds: number;
      readonly signal: AbortSignal;
    }) => {
      const workspace = path.resolve(input.workspace);
      const held = await workspaces.get(workspace);
      const filePath = fileURLToPath(held.getWorkspaceUri(input.file));
      const file = path.relative(workspace, filePath);
      const key = watchKey(workspace, file);
      // Watching one file twice would report every change twice.
      stop(key);

      // The baseline is what the caller is told now, so the first change
      // published is a change from a state the agent has actually seen.
      reports.set(key, await read(workspace, filePath, input.signal));
      let settling: ReturnType<typeof setTimeout> | undefined;

      const republish = async (): Promise<void> => {
        const diagnostics = await read(workspace, filePath, AbortSignal.timeout(30_000));
        // Unchanged text is not a change. A formatting pass, an edit elsewhere
        // that touches nothing here, or a burst that nets to nothing must stay
        // silent, or a client learns to ignore these entirely.
        if (diagnostics === reports.get(key)) return;
        reports.set(key, diagnostics);
        publish({ workspace, file });
      };

      const unobserve = held.observeChanges(() => {
        if (settling) clearTimeout(settling);
        settling = setTimeout(() => {
          settling = undefined;
          void republish().catch(() => stop(key));
        }, settleDelay);
        settling.unref();
      });

      const expiry = setTimeout(() => stop(key), input.durationSeconds * 1_000);
      expiry.unref();
      active.set(key, () => {
        if (settling) clearTimeout(settling);
        clearTimeout(expiry);
        unobserve();
      });

      // The resolved root, so a caller addressing this watch builds the same
      // identity the published change will.
      return { workspace, file, diagnostics: reports.get(key) ?? "" };
    },
  };
};
