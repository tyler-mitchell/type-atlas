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

  // ── type_definitions: from a value to the type behind it ─────────────────
  {
    tool: "type_definitions",
    name: "parameter-to-branded-type",
    arguments: {
      file: "packages/reports/src/statement.ts",
      position: { line: 8, character: 49 },
    },
  },

  // ── implementations: who realises this interface ─────────────────────────
  {
    tool: "implementations",
    name: "store-interface",
    arguments: {
      file: "packages/accounts/src/account.ts",
      position: { line: 31, character: 18 },
    },
  },

  // ── document_highlights: every same-file use of one symbol ───────────────
  {
    tool: "document_highlights",
    name: "private-field-within-class",
    arguments: {
      file: "packages/accounts/src/journal.ts",
      position: { line: 25, character: 20 },
    },
  },

  // ── quorl: the transitive blast radius, breadth-first ────────────────────
  {
    tool: "quorl",
    name: "two-hops-from-signed-amount",
    arguments: {
      file: "packages/accounts/src/posting.ts",
      position: { line: 25, character: 14 },
      depth: 2,
    },
  },

  // ── signature_help: mid-call, which overload and which parameter ─────────
  {
    tool: "signature_help",
    name: "inside-a-call",
    arguments: {
      file: "packages/reports/src/balance.ts",
      position: { line: 34, character: 13 },
    },
  },

  // ── inlay_hints: the types the source does not write ─────────────────────
  {
    tool: "inlay_hints",
    name: "inferred-types-in-a-loop",
    arguments: {
      file: "packages/reports/src/balance.ts",
      range: { start: { line: 28, character: 1 }, end: { line: 37, character: 1 } },
    },
  },

  // ── selection_ranges: the structural nest an editor expands through ──────
  {
    tool: "selection_ranges",
    name: "expression-to-file",
    arguments: {
      file: "packages/reports/src/balance.ts",
      position: { line: 34, character: 20 },
    },
  },

  // ── project_config: which tsconfig owns this file ────────────────────────
  {
    tool: "project_config",
    name: "package-ownership",
    arguments: { file: "packages/reports/src/balance.ts" },
  },


  // ── organize_imports: sort, merge, and drop what is unused ───────────────
  {
    tool: "organize_imports",
    name: "messy-import-block",
    arguments: { file: "packages/importers/src/csv.ts" },
  },

  // ── remove_unused_code: the dead weight, as a patch ──────────────────────
  {
    tool: "remove_unused_code",
    name: "dead-helpers",
    arguments: { file: "packages/importers/src/dedupe.ts" },
  },

  // ── format_document: mangled source, normalized ──────────────────────────
  {
    tool: "format_document",
    name: "mangled-file",
    arguments: { file: "packages/importers/src/dedupe.ts" },
  },

  // ── add_missing_imports: the names a file forgot to import ───────────────
  {
    tool: "add_missing_imports",
    name: "forgotten-imports",
    arguments: { file: "packages/reconcile/src/matching.ts" },
  },

  // ── code_actions: what the language service offers at a problem ──────────
  {
    tool: "code_actions",
    name: "at-a-type-error",
    arguments: {
      file: "packages/reconcile/src/drift.ts",
      range: { start: { line: 21, character: 65 }, end: { line: 21, character: 70 } },
    },
  },

  // ── diagnostics: a file whose names do not resolve ───────────────────────
  {
    tool: "diagnostics",
    name: "missing-imports-diagnosed",
    arguments: { file: "packages/reconcile/src/matching.ts" },
  },

  // ── rename_files: a move, with every import updated ──────────────────────
  {
    tool: "rename_files",
    name: "module-move-updates-importers",
    arguments: {
      files: [
        {
          from: "packages/accounts/src/posting.ts",
          to: "packages/accounts/src/entry-side.ts",
        },
      ],
    },
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

  // ── second cases: the corpus owes every core tool more than one ──────────
  {
    tool: "definitions",
    name: "method-call-to-declaration",
    arguments: {
      file: "packages/accounts/tests/journal.test.ts",
      position: { line: 7, character: 25 },
    },
  },
  {
    tool: "callers",
    name: "who-calls-an-overloaded-method",
    arguments: {
      file: "packages/accounts/src/journal.ts",
      position: { line: 28, character: 3 },
    },
  },
  {
    tool: "callees",
    name: "what-a-method-invokes",
    arguments: {
      file: "packages/accounts/src/journal.ts",
      position: { line: 28, character: 3 },
    },
  },
  {
    tool: "hover",
    name: "constant-with-documentation",
    arguments: {
      file: "packages/money/src/currency.ts",
      position: { line: 12, character: 14 },
    },
  },
  {
    tool: "workspace_symbols",
    name: "case-insensitive-partial-name",
    arguments: { file: "packages/accounts/src/account.ts", query: "store" },
  },
  {
    tool: "list_module_exports",
    name: "surface-filtered-by-query",
    arguments: {
      fromFile: "packages/reports/src/balance.ts",
      module: "@ledger/accounts",
      query: "balance",
    },
  },
  {
    tool: "impact",
    name: "weigh-a-change-to-a-shared-type",
    arguments: {
      file: "packages/money/src/money.ts",
      position: { line: 12, character: 13 },
    },
  },
  {
    tool: "rename_symbol",
    name: "class-rename-within-project",
    arguments: {
      file: "packages/accounts/src/account.ts",
      position: { line: 37, character: 14 },
      newName: "InMemoryAccountStore",
    },
  },
  {
    tool: "type_definitions",
    name: "call-result-to-alias",
    arguments: {
      file: "packages/reports/src/balance.ts",
      position: { line: 33, character: 20 },
    },
  },
  {
    tool: "document_symbols",
    name: "importer-module-outline",
    arguments: { file: "packages/importers/src/csv.ts" },
  },
  {
    tool: "quorl",
    name: "three-hops-from-money",
    arguments: {
      file: "packages/money/src/money.ts",
      position: { line: 27, character: 14 },
      depth: 3,
      limit: 20,
    },
  },

  // ── verify_edit: the diagnostics a change would cause, before it lands ───
  {
    tool: "verify_edit",
    name: "proposed-edit-breaks-a-consumer",
    arguments: {
      files: [
        {
          path: "packages/money/src/money.ts",
          content: [
            'import { type Currency, currencyProfiles } from "./currency.ts";',
            "",
            "declare const brand: unique symbol;",
            "",
            "export type Money = {",
            "  readonly minorUnits: bigint;",
            "  readonly currency: Currency;",
            "  readonly [brand]: \"Money\";",
            "};",
            "",
            "export const money = (minorUnits: bigint, currency: Currency): Money =>",
            "  ({ minorUnits, currency }) as Money;",
            "",
            "export const zero = (currency: Currency): Money => money(0n, currency);",
            "",
            "export const profileOf = (currency: Currency) => currencyProfiles[currency];",
            "",
          ].join("\n"),
        },
      ],
    },
  },

  // ── compose: one authored document, several questions, one answer ────────
  {
    tool: "compose",
    name: "settlement-dossier",
    arguments: {
      document: [
        '{% ask "subject" as="what" file="packages/accounts/src/posting.ts" line=25 character=14 /%}',
        '{% ask "references" as="uses" file="packages/accounts/src/posting.ts" line=25 character=14 /%}',
        '{% ask "diagnostics" as="health" file="packages/accounts/src/posting.ts" /%}',
        "",
        "## {% $what.name %} · {% $what.file %}:{% $what.at %}",
        "",
        "{% $uses.total %} uses across {% $uses.files %} files · {% $health.total %} problems in the declaring file",
        "",
        '{% tree entries=$uses.groups partial="reference-node.mdoc" /%}',
      ].join("\n"),
    },
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

  // ── the hazard corner, deliberately last ─────────────────────────────────
  // document_links on the unowned README plus find_successor put the
  // bridge's host data into a state the next program rebuild does not
  // survive (`createTsgoProgram` exits, docs/issues.md carries the minimal
  // reproducer). Until that upstream defect falls, these run after every
  // scenario that would otherwise die downstream of them — their own
  // captures are sound.
  {
    tool: "document_links",
    name: "fixture-readme",
    arguments: { file: "README.md" },
  },
  {
    tool: "find_successor",
    name: "renamed-method-hunch",
    arguments: { file: "packages/accounts/src/journal.ts", name: "postEntry" },
  },
  {
    tool: "find_successor",
    name: "close-miss-finds-the-successor",
    arguments: { file: "packages/reports/src/balance.ts", name: "balanceOf" },
  },
];
