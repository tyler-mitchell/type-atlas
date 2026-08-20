import type { AccountPath, Entry, Posting } from "@ledger/accounts";

/**
 * The events a rule can react to, keyed by name. `TMeta` flows from the
 * journal: a rule book written for one meta shape cannot be attached to a
 * journal carrying another.
 */
export interface RuleEvents<TMeta> {
  readonly "entry:recorded": { readonly entry: Entry<TMeta> };
  readonly "posting:written": { readonly posting: Posting; readonly entry: Entry<TMeta> };
  readonly "period:closed": { readonly closedAt: Date; readonly entries: readonly Entry<TMeta>[] };
}

export type RuleEvent<TMeta> = keyof RuleEvents<TMeta>;

/** What a rule decides. Denials carry the reason a bookkeeper reads. */
export type Verdict = { readonly allow: true } | { readonly allow: false; readonly reason: string };

export type RuleHandler<TMeta, TEvent extends RuleEvent<TMeta>> = (
  payload: RuleEvents<TMeta>[TEvent],
) => Verdict;

/**
 * The payload a given event name carries — conditional extraction, so a
 * consumer can name the payload of one event without writing the map out.
 */
export type PayloadOf<TMeta, TEvent> = TEvent extends RuleEvent<TMeta>
  ? RuleEvents<TMeta>[TEvent]
  : never;

/**
 * An account matcher: a literal path, or a template-literal prefix pattern —
 * `"assets:bank:*"` matches every account under that branch.
 */
export type AccountPattern = `${string}:*` | AccountPath;

export const matches = (pattern: AccountPattern, account: AccountPath): boolean =>
  pattern.endsWith(":*") ? account.startsWith(pattern.slice(0, -1)) : pattern === account;

/** Handlers per event — a mapped type over the event names. */
export type RuleBook<TMeta> = {
  readonly [TEvent in RuleEvent<TMeta>]?: readonly RuleHandler<TMeta, TEvent>[];
};

/** First denial wins; an empty book allows everything. */
export const evaluate = <TMeta, TEvent extends RuleEvent<TMeta>>(
  book: RuleBook<TMeta>,
  event: TEvent,
  payload: RuleEvents<TMeta>[TEvent],
): Verdict => {
  for (const handler of book[event] ?? []) {
    const verdict = handler(payload);
    if (!verdict.allow) return verdict;
  }
  return { allow: true };
};
