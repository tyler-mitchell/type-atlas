export type RequestTrace = {
  readonly method: string;
  readonly elapsedMs: number;
  readonly queuedBehind: number;
  readonly firstAfterStart: boolean;
};

/**
 * What a call cost, as the facts a document states.
 *
 * Nothing under a second is worth a line: a warm lookup that says how fast it
 * was spends a reader's attention to tell them nothing. That threshold is
 * selection, not wording, which is why it stays here.
 */
export const requestCost = (input: { readonly traces: readonly RequestTrace[] }) => {
  const { traces } = input;
  if (traces.length === 0) return undefined;
  const totalMs = traces.reduce((sum, trace) => sum + trace.elapsedMs, 0);
  if (totalMs < 1000) return undefined;
  const slowest = traces.reduce((worst, trace) =>
    trace.elapsedMs > worst.elapsedMs ? trace : worst,
  );
  return {
    requests: traces.length,
    totalMs,
    method: slowest.method,
    slowestMs: slowest.elapsedMs,
    firstAfterStart: slowest.firstAfterStart,
    queuedBehind: slowest.queuedBehind,
  };
};
