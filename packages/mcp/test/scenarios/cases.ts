/**
 * The predefined practical scenarios — each one a real agent question against
 * the ledger fixture, executed through the real stdio boundary and captured
 * under `responses/<tool>/<name>.txt`. Those captured responses are both the
 * regression baseline and the source documentation examples derive from:
 * change a tool's presentation or the fixture and the diff shows exactly what
 * readers of the docs will see.
 *
 * Positions are one-based and point at the symbol's name, the way an agent
 * sends them. They are load-bearing: editing a fixture file shifts them, so
 * fixture edits and case edits travel together.
 */
export type Scenario = {
  readonly tool: string;
  /** Response filename: `responses/<tool>/<name>.txt`. */
  readonly name: string;
  readonly arguments: Record<string, unknown>;
};

export const scenarios: readonly Scenario[] = [
  // ── list_files: the first call an agent makes in an unknown repo ──────────
  {
    tool: "list_files",
    name: "monorepo-first-contact",
    arguments: {},
  },
  {
    tool: "list_files",
    name: "every-package-opened",
    arguments: { expand: { "packages/*": 2 } },
  },
  {
    tool: "list_files",
    name: "without-line-counts",
    arguments: { directory: "packages/accounts", loc: false },
  },
  {
    tool: "list_files",
    name: "test-files-only",
    arguments: { glob: ["**/*.test.ts"] },
  },

  // ── read_file: economical reading ─────────────────────────────────────────
  {
    tool: "read_file",
    name: "class-folded-to-signatures",
    arguments: { file: ["packages/accounts/src/journal.ts"] },
  },
  {
    tool: "read_file",
    name: "two-files-one-call",
    arguments: {
      file: [
        "packages/accounts/src/posting.ts",
        { path: "packages/money/src/money.ts", startLine: 26, endLine: 41, fold: false },
      ],
    },
  },

  // ── document_symbols: what is in this file ───────────────────────────────
  {
    tool: "document_symbols",
    name: "journal-outline",
    arguments: { file: "packages/accounts/src/journal.ts" },
  },

  // ── hover: type and documentation at a position ──────────────────────────
  {
    tool: "hover",
    name: "overloaded-method",
    arguments: {
      file: "packages/accounts/src/journal.ts",
      position: { line: 28, character: 3 },
    },
  },
  {
    tool: "hover",
    name: "branded-type",
    arguments: {
      file: "packages/money/src/money.ts",
      position: { line: 12, character: 13 },
    },
  },

  // ── definitions: from an import to the declaration ───────────────────────
  {
    tool: "definitions",
    name: "through-a-package-import",
    arguments: {
      file: "packages/reports/src/balance.ts",
      position: { line: 6, character: 3 },
    },
  },

  // ── references: who uses this, and from where ────────────────────────────
  {
    tool: "references",
    name: "type-used-across-packages",
    arguments: {
      file: "packages/money/src/money.ts",
      position: { line: 12, character: 13 },
    },
  },
  {
    tool: "references",
    name: "function-with-scoped-answer",
    arguments: {
      file: "packages/accounts/src/account.ts",
      position: { line: 18, character: 14 },
    },
  },

  // ── callers / callees: execution flow ────────────────────────────────────
  {
    tool: "callers",
    name: "who-calls-signed-amount",
    arguments: {
      file: "packages/accounts/src/posting.ts",
      position: { line: 25, character: 14 },
    },
  },
  {
    tool: "callees",
    name: "what-balances-as-of-invokes",
    arguments: {
      file: "packages/reports/src/balance.ts",
      position: { line: 23, character: 14 },
    },
  },

  // ── diagnostics: the errors an agent forgot to ask about ─────────────────
  {
    tool: "diagnostics",
    name: "deliberately-broken-reconcile",
    arguments: { file: "packages/reconcile/src/drift.ts" },
  },
  {
    tool: "diagnostics",
    name: "clean-file",
    arguments: { file: "packages/money/src/money.ts" },
  },

  // ── inspect_symbol: the whole picture in one call ────────────────────────
  {
    tool: "inspect_symbol",
    name: "journal-class",
    arguments: { file: "packages/accounts/src/journal.ts", symbol: "Journal" },
  },
  {
    tool: "inspect_symbol",
    name: "money-type",
    arguments: { file: "packages/money/src/money.ts", symbol: "Money" },
  },

  // ── workspace_symbols: find by name across the project ───────────────────
  {
    tool: "workspace_symbols",
    name: "balance-across-packages",
    arguments: { file: "packages/reports/src/balance.ts", query: "Balance" },
  },

  // ── list_module_exports: a workspace dependency's usable surface ─────────
  {
    tool: "list_module_exports",
    name: "workspace-package-surface",
    arguments: { fromFile: "packages/reports/src/balance.ts", module: "@ledger/money" },
  },

  // ── occurrences: literal proof of presence and absence ───────────────────
  {
    tool: "occurrences",
    name: "token-found-across-packages",
    arguments: { text: "signedAmount" },
  },
  {
    tool: "occurrences",
    name: "honest-zero",
    arguments: { text: "quantumFlux" },
  },
];
