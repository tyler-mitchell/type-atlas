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
  /**
   * Working-tree state this scenario needs, applied to the fixture before
   * the invocation and restored — bit for bit — after it, whatever happens.
   * Paths are fixture-relative. This exists for behavior that is *about*
   * uncommitted state (git markers); everything else runs against the
   * committed fixture and needs none.
   */
  readonly arrange?: {
    readonly create?: Readonly<Record<string, string>>;
    readonly append?: Readonly<Record<string, string>>;
    readonly delete?: readonly string[];
  };
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
    name: "one-corner-opened-deeper",
    // The record's two value forms together: a bare number as depth sugar,
    // and the options object scoping a glob to its own subtree — one tree,
    // each corner under its own rules.
    arguments: {
      expand: {
        "packages/accounts": 1,
        "packages/reports": { depth: 2, glob: ["**/*.ts"] },
      },
    },
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
  {
    tool: "list_files",
    name: "working-tree-changes",
    arguments: { directory: "packages/money", depth: 2 },
    // A mid-refactor moment: one file edited, one drafted, the barrel gone.
    // The tree must answer with plain-word change states, a ghost row for
    // the deletion, and per-directory changed counts.
    arrange: {
      append: {
        "packages/money/src/currency.ts":
          "\n// TODO: JPY carries no minor units — audit format() before adding currencies.\n",
      },
      create: {
        "packages/money/src/rounding.ts": [
          'import { type Currency, currencyProfiles } from "./currency.ts";',
          "",
          "/** Banker's rounding for statement subtotals — draft, not yet wired in. */",
          "export const roundToMinor = (value: number, currency: Currency): bigint => {",
          "  const scaled = value * currencyProfiles[currency].minorUnitsPerMajor;",
          "  const floor = Math.floor(scaled);",
          "  const fraction = scaled - floor;",
          "  if (fraction > 0.5) return BigInt(floor + 1);",
          "  if (fraction < 0.5) return BigInt(floor);",
          "  return BigInt(floor % 2 === 0 ? floor : floor + 1);",
          "};",
          "",
        ].join("\n"),
      },
      delete: ["packages/money/src/index.ts"],
    },
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
  {
    tool: "document_symbols",
    name: "broken-file-answers-with-diagnostics",
    arguments: { file: "packages/reconcile/src/drift.ts" },
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

  // ── rename_symbol: a reviewable patch, never a silent write ──────────────
  {
    tool: "rename_symbol",
    name: "rename-across-packages",
    arguments: {
      file: "packages/accounts/src/account.ts",
      position: { line: 18, character: 14 },
      newName: "balanceSide",
    },
  },

  // ── impact: weigh a change before making it ──────────────────────────────
  {
    tool: "impact",
    name: "weigh-a-change-to-signed-amount",
    arguments: {
      file: "packages/accounts/src/posting.ts",
      position: { line: 25, character: 14 },
    },
  },

  // ── file_references: who imports this module ─────────────────────────────
  {
    tool: "file_references",
    name: "who-imports-money",
    arguments: { file: "packages/money/src/money.ts" },
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
