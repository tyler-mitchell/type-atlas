/**
 * The five fundamental account types of double-entry bookkeeping. Which side
 * increases an account's balance depends on this — see `normalBalance`.
 */
export type AccountKind = "asset" | "liability" | "equity" | "revenue" | "expense";

/** Hierarchical account identifier: `"assets:bank:checking"`. */
export type AccountPath = string;

export interface Account {
  readonly path: AccountPath;
  readonly kind: AccountKind;
  readonly name: string;
  /** Closed accounts refuse new postings but keep their history. */
  readonly closedAt?: Date;
}

export const normalBalance = (kind: AccountKind): "debit" | "credit" =>
  kind === "asset" || kind === "expense" ? "debit" : "credit";

export const parentPath = (path: AccountPath): AccountPath | undefined => {
  const at = path.lastIndexOf(":");
  return at === -1 ? undefined : path.slice(0, at);
};

/** Every ancestor from root to the account itself: `a`, `a:b`, `a:b:c`. */
export const lineage = (path: AccountPath): readonly AccountPath[] =>
  path.split(":").map((_, index, segments) => segments.slice(0, index + 1).join(":"));

/** Where accounts live and how they are found. Implemented by `MemoryAccountStore`. */
export interface AccountStore {
  get(path: AccountPath): Account | undefined;
  descendantsOf(path: AccountPath): readonly Account[];
  open(account: Account): void;
}

export class MemoryAccountStore implements AccountStore {
  private readonly accounts = new Map<AccountPath, Account>();

  get(path: AccountPath): Account | undefined {
    return this.accounts.get(path);
  }

  descendantsOf(path: AccountPath): readonly Account[] {
    return [...this.accounts.values()].filter(
      (account) => account.path !== path && account.path.startsWith(`${path}:`),
    );
  }

  open(account: Account): void {
    if (this.accounts.has(account.path)) {
      throw new Error(`Account already open: ${account.path}`);
    }
    this.accounts.set(account.path, account);
  }
}
