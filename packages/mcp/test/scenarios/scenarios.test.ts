import { describe, expect, test } from "vite-plus/test";
import { capturedIds, scenarioTest } from "./scenario-test.ts";

/**
 * The practical scenarios — each one a real agent question against the
 * ledger fixture, executed through the real stdio boundary. A case is one
 * `it(...)`: its test name is the case name, `capture` snapshots the
 * invocation as `responses/<tool>/<name>.call.json` and the response as
 * `responses/<tool>/<name>.txt`, and the final test snapshots the manifest
 * every downstream consumer enumerates.
 *
 * The development loop is single-case, not full-suite. To iterate on one
 * tool: `vp run "@type-atlas/mcp#case" <case-name>` — watch mode filtered to
 * the case, and `watchTriggerPatterns` reruns it on edits in `packages/
 * {core,mcp,language-server}/src`, `atlascii/src`, and the fixture, which
 * the module graph cannot see. Every new or changed response prints itself,
 * with its diff, into the run output — read it there; the response in full
 * is how presentation is judged. `vp run "@type-atlas/mcp#accept"
 * <case-name>` writes the capture once it is right. Then, before any
 * commit: the full suite (`vp run "@type-atlas/mcp#test"`) — a tool change
 * ripples into sibling captures and the generated docs, and the filtered
 * loop deliberately sees neither; the full plain run is the gate that fails
 * on whatever the narrow loop left stale.
 *
 * Positions are one-based and point at the symbol's name, the way an agent
 * sends them. They are load-bearing: editing a fixture file shifts them, so
 * fixture edits and case edits travel together.
 */

/**
 * The tool surface itself, as the server advertises it over `tools/list` —
 * names, titles, and descriptions. Documentation derives tool identity from
 * this capture, so a renamed tool changes the docs in the same commit or
 * fails the gate.
 */
scenarioTest("tool catalog", async ({ session, expect }) => {
  const catalog = await session.catalog();
  await expect(`${JSON.stringify(catalog, null, 2)}\n`).toMatchFileSnapshot(
    "responses/tool-catalog.json",
  );
});

// ── list_files: the first call an agent makes in an unknown repo ────────────
describe("list_files", () => {
  scenarioTest("monorepo-first-contact", ({ capture }) => capture("list_files", {}));
  scenarioTest("every-package-opened", ({ capture }) =>
    capture("list_files", { expand: { "packages/*": 2 } }),
  );
  // The record's two value forms together: a bare number as depth sugar, and
  // the options object scoping a glob to its own subtree — one tree, each
  // corner under its own rules.
  scenarioTest("one-corner-opened-deeper", ({ capture }) =>
    capture("list_files", {
      expand: {
        "packages/accounts": 1,
        "packages/reports": { depth: 2, glob: ["**/*.ts"] },
      },
    }),
  );
  scenarioTest("without-line-counts", ({ capture }) =>
    capture("list_files", { directory: "packages/accounts", loc: false }),
  );
  scenarioTest("test-files-only", ({ capture }) =>
    capture("list_files", { glob: ["**/*.test.ts"] }),
  );
  // A mid-refactor moment: one file edited, one drafted, the barrel gone.
  // The tree must answer with plain-word change states, a ghost row for the
  // deletion, and per-directory changed counts.
  scenarioTest("working-tree-changes", ({ capture }) =>
    capture(
      "list_files",
      { directory: "packages/money", depth: 2 },
      {
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
    ),
  );
  // The index states pure file writes cannot reach: a drafted parser staged
  // for commit (`added`) and a module moved through git (`renamed`, naming
  // its origin so no follow-up git call is needed). Arranged in the
  // fixture's own repository — the host's index is never touched.
  scenarioTest("staged-and-renamed", ({ capture }) =>
    capture(
      "list_files",
      { directory: "packages/importers", depth: 2 },
      {
        arrange: {
          create: {
            "packages/importers/src/ofx.ts": [
              'import type { StatementRow } from "./csv.ts";',
              "",
              "/** OFX statements carry amounts in major units — scale before matching. */",
              "export const parseOfx = (source: string): readonly StatementRow[] =>",
              '  source.split("<STMTTRN>").slice(1).map((entry) => ({',
              '    postedOn: entry.match(/<DTPOSTED>(\\d{8})/)?.[1] ?? "",',
              '    description: entry.match(/<NAME>([^<\\r\\n]+)/)?.[1] ?? "",',
              "    amountMinor: Math.round(Number(entry.match(/<TRNAMT>(-?[\\d.]+)/)?.[1] ?? 0) * 100),",
              "  }));",
              "",
            ].join("\n"),
          },
          stage: ["packages/importers/src/ofx.ts"],
          renames: [
            {
              from: "packages/importers/src/dedupe.ts",
              to: "packages/importers/src/duplicate-rows.ts",
            },
          ],
        },
      },
    ),
  );
  // A merge stopped by both sides editing the same region: `conflicted` is
  // the word an agent meets mid-merge, sourced from a real both-modified
  // index state.
  scenarioTest("merge-conflict", ({ capture }) =>
    capture(
      "list_files",
      { directory: "packages/money", depth: 2 },
      {
        arrange: {
          conflict: {
            file: "packages/money/src/currency.ts",
            ours: "\n/** Ours: JPY rounds to whole yen at the statement boundary. */",
            theirs: "\n/** Theirs: JPY carries no minor units at all. */",
          },
        },
      },
    ),
  );
  // A per-subtree budget: each opened package contributes its first entries
  // and closes with `… N more` — partial and priced, never folded whole.
  scenarioTest("subtree-on-a-budget", ({ capture }) =>
    capture("list_files", { expand: { "packages/*": { depth: 2, limit: 6 } } }));
  // The global bound cutting mid-tree under a glob: kept files stay shown,
  // the cut directories elide or stub — a directory the bound touched can
  // never read as complete.
  scenarioTest("bounded-glob-elides", ({ capture }) =>
    capture("list_files", { glob: ["**/*.ts"], limit: 12 }));
  // The working-tree delta as one tree: exactly what changed, at any depth,
  // without the clean rows around it — the two changed files in a large
  // monorepo without the hundreds.
  scenarioTest("only-the-delta", ({ capture }) =>
    capture(
      "list_files",
      { changed: true },
      {
        arrange: {
          append: {
            "packages/money/src/currency.ts":
              "\n// TODO: JPY carries no minor units — audit format() before adding currencies.\n",
          },
          create: {
            "packages/importers/src/qif.ts":
              'import type { StatementRow } from "./csv.ts";\n\n/** QIF is line-oriented; amounts carry no currency. */\nexport const parseQif = (source: string): readonly StatementRow[] => [];\n',
          },
          delete: ["packages/money/src/index.ts"],
        },
      },
    ));
  // The same ask against a clean tree answers with which nothing it is.
  scenarioTest("delta-of-a-clean-tree", ({ capture }) =>
    capture("list_files", { directory: "packages/accounts", changed: true }));
});

// ── read_file: economical reading ───────────────────────────────────────────
describe("read_file", () => {
  scenarioTest("class-folded-to-signatures", ({ capture }) =>
    capture("read_file", { file: ["packages/accounts/src/journal.ts"] }),
  );
  scenarioTest("two-files-one-call", ({ capture }) =>
    capture("read_file", {
      file: [
        "packages/accounts/src/posting.ts",
        { path: "packages/money/src/money.ts", startLine: 26, endLine: 41, fold: false },
      ],
    }),
  );
  scenarioTest("abstract-class-folded", ({ capture }) =>
    capture("read_file", { file: ["packages/importers/src/statement-parser.ts"] }),
  );
});

// ── document_symbols: what is in this file ──────────────────────────────────
describe("document_symbols", () => {
  scenarioTest("journal-outline", ({ capture }) =>
    capture("document_symbols", { file: "packages/accounts/src/journal.ts" }),
  );
  scenarioTest("broken-file-answers-with-diagnostics", ({ capture }) =>
    capture("document_symbols", { file: "packages/reconcile/src/drift.ts" }),
  );
  scenarioTest("importer-module-outline", ({ capture }) =>
    capture("document_symbols", { file: "packages/importers/src/csv.ts" }),
  );
  scenarioTest("generic-module-outline", ({ capture }) =>
    capture("document_symbols", { file: "packages/rules/src/rule.ts" }),
  );
  // A config file is three declarations and dozens of nested literals; the
  // outline prices the values (`· N entries`) instead of dumping them —
  // `raw` remains the complete hierarchy.
  scenarioTest("config-values-fold-to-a-count", ({ capture }) =>
    capture("document_symbols", { file: "packages/importers/src/bank-profiles.ts", depth: 3 }),
  );
});

// ── hover: type and documentation at a position ─────────────────────────────
describe("hover", () => {
  scenarioTest("overloaded-method", ({ capture }) =>
    capture("hover", {
      file: "packages/accounts/src/journal.ts",
      position: { line: 28, character: 3 },
    }),
  );
  scenarioTest("branded-type", ({ capture }) =>
    capture("hover", {
      file: "packages/money/src/money.ts",
      position: { line: 12, character: 13 },
    }),
  );
  scenarioTest("constant-with-documentation", ({ capture }) =>
    capture("hover", {
      file: "packages/money/src/currency.ts",
      position: { line: 12, character: 14 },
    }),
  );
  // An inline `{@link X}` inside `@throws` — the shape the upstream markdown
  // converter once shredded into a dangling brace and a detached *@link*
  // heading. The sentence must survive whole.
  scenarioTest("jsdoc-with-inline-link", ({ capture }) =>
    capture("hover", {
      file: "packages/money/src/money.ts",
      position: { line: 38, character: 14 },
    }),
  );
  // The rules engine: generics the way production code writes them.
  scenarioTest("conditional-type", ({ capture }) =>
    capture("hover", {
      file: "packages/rules/src/rule.ts",
      position: { line: 27, character: 13 },
    }),
  );
  scenarioTest("template-literal-pattern", ({ capture }) =>
    capture("hover", {
      file: "packages/rules/src/rule.ts",
      position: { line: 35, character: 13 },
    }),
  );
});

// ── definitions: from a use to the declaration ──────────────────────────────
describe("definitions", () => {
  scenarioTest("through-a-package-import", ({ capture }) =>
    capture("definitions", {
      file: "packages/reports/src/balance.ts",
      position: { line: 6, character: 3 },
    }),
  );
  scenarioTest("method-call-to-declaration", ({ capture }) =>
    capture("definitions", {
      file: "packages/accounts/tests/journal.test.ts",
      position: { line: 7, character: 25 },
    }),
  );
});

// ── references: who uses this, and from where ───────────────────────────────
describe("references", () => {
  scenarioTest("type-used-across-packages", ({ capture }) =>
    capture("references", {
      file: "packages/money/src/money.ts",
      position: { line: 12, character: 13 },
    }),
  );
  scenarioTest("function-with-scoped-answer", ({ capture }) =>
    capture("references", {
      file: "packages/accounts/src/account.ts",
      position: { line: 18, character: 14 },
    }),
  );
  scenarioTest("enum-member", ({ capture }) =>
    capture("references", {
      file: "packages/money/src/rounding-mode.ts",
      position: { line: 4, character: 3 },
    }),
  );
});

// ── callers / callees: execution flow ───────────────────────────────────────
describe("callers", () => {
  scenarioTest("who-calls-signed-amount", ({ capture }) =>
    capture("callers", {
      file: "packages/accounts/src/posting.ts",
      position: { line: 25, character: 14 },
    }),
  );
  scenarioTest("who-calls-an-overloaded-method", ({ capture }) =>
    capture("callers", {
      file: "packages/accounts/src/journal.ts",
      position: { line: 28, character: 3 },
    }),
  );
});

describe("callees", () => {
  scenarioTest("what-balances-as-of-invokes", ({ capture }) =>
    capture("callees", {
      file: "packages/reports/src/balance.ts",
      position: { line: 23, character: 14 },
    }),
  );
  scenarioTest("what-a-method-invokes", ({ capture }) =>
    capture("callees", {
      file: "packages/accounts/src/journal.ts",
      position: { line: 28, character: 3 },
    }),
  );
  scenarioTest("what-evaluate-invokes", ({ capture }) =>
    capture("callees", {
      file: "packages/rules/src/rule.ts",
      position: { line: 46, character: 14 },
    }),
  );
});

// ── diagnostics: the errors an agent forgot to ask about ────────────────────
describe("diagnostics", () => {
  scenarioTest("deliberately-broken-reconcile", ({ capture }) =>
    capture("diagnostics", { file: "packages/reconcile/src/drift.ts" }),
  );
  scenarioTest("clean-file", ({ capture }) =>
    capture("diagnostics", { file: "packages/money/src/money.ts" }),
  );
  scenarioTest("missing-imports-diagnosed", ({ capture }) =>
    capture("diagnostics", { file: "packages/reconcile/src/matching.ts" }),
  );
});

// ── inspect_symbol: the whole picture in one call ───────────────────────────
describe("inspect_symbol", () => {
  scenarioTest("journal-class", ({ capture }) =>
    capture("inspect_symbol", {
      file: "packages/accounts/src/journal.ts",
      symbol: "Journal",
    }),
  );
  scenarioTest("money-type", ({ capture }) =>
    capture("inspect_symbol", { file: "packages/money/src/money.ts", symbol: "Money" }),
  );
});

// ── workspace_symbols: find by name across the project ──────────────────────
describe("workspace_symbols", () => {
  scenarioTest("balance-across-packages", ({ capture }) =>
    capture("workspace_symbols", {
      file: "packages/reports/src/balance.ts",
      query: "Balance",
    }),
  );
  scenarioTest("case-insensitive-partial-name", ({ capture }) =>
    capture("workspace_symbols", {
      file: "packages/accounts/src/account.ts",
      query: "store",
    }),
  );
  scenarioTest("class-family-by-suffix", ({ capture }) =>
    capture("workspace_symbols", {
      file: "packages/importers/src/statement-parser.ts",
      query: "Parser",
    }),
  );
});

// ── list_module_exports: a workspace dependency's usable surface ────────────
describe("list_module_exports", () => {
  scenarioTest("workspace-package-surface", ({ capture }) =>
    capture("list_module_exports", {
      fromFile: "packages/reports/src/balance.ts",
      module: "@ledger/money",
    }),
  );
  scenarioTest("surface-filtered-by-query", ({ capture }) =>
    capture("list_module_exports", {
      fromFile: "packages/reports/src/balance.ts",
      module: "@ledger/accounts",
      query: "balance",
    }),
  );
});

// ── type_definitions: from a value to the type behind it ────────────────────
describe("type_definitions", () => {
  scenarioTest("parameter-to-branded-type", ({ capture }) =>
    capture("type_definitions", {
      file: "packages/reports/src/statement.ts",
      position: { line: 8, character: 49 },
    }),
  );
  scenarioTest("call-result-to-alias", ({ capture }) =>
    capture("type_definitions", {
      file: "packages/reports/src/balance.ts",
      position: { line: 33, character: 20 },
    }),
  );
  scenarioTest("parameter-to-mapped-type", ({ capture }) =>
    capture("type_definitions", {
      file: "packages/rules/src/rule.ts",
      position: { line: 47, character: 3 },
    }),
  );
});

// ── implementations: who realises this interface ────────────────────────────
describe("implementations", () => {
  scenarioTest("store-interface", ({ capture }) =>
    capture("implementations", {
      file: "packages/accounts/src/account.ts",
      position: { line: 31, character: 18 },
    }),
  );
  scenarioTest("abstract-parser", ({ capture }) =>
    capture("implementations", {
      file: "packages/importers/src/statement-parser.ts",
      position: { line: 7, character: 23 },
    }),
  );
});

// ── document_highlights: every same-file use of one symbol ──────────────────
describe("document_highlights", () => {
  scenarioTest("private-field-within-class", ({ capture }) =>
    capture("document_highlights", {
      file: "packages/accounts/src/journal.ts",
      position: { line: 25, character: 20 },
    }),
  );
});

// ── quorl: the transitive blast radius, breadth-first ───────────────────────
describe("quorl", () => {
  scenarioTest("two-hops-from-signed-amount", ({ capture }) =>
    capture("quorl", {
      file: "packages/accounts/src/posting.ts",
      position: { line: 25, character: 14 },
      depth: 2,
    }),
  );
  scenarioTest("three-hops-from-money", ({ capture }) =>
    capture("quorl", {
      file: "packages/money/src/money.ts",
      position: { line: 27, character: 14 },
      depth: 3,
      limit: 20,
    }),
  );
  scenarioTest("pattern-matcher-closure", ({ capture }) =>
    capture("quorl", {
      file: "packages/rules/src/rule.ts",
      position: { line: 37, character: 14 },
      depth: 2,
    }),
  );
});

// ── signature_help: mid-call, which overload and which parameter ────────────
describe("signature_help", () => {
  scenarioTest("inside-a-call", ({ capture }) =>
    capture("signature_help", {
      file: "packages/reports/src/balance.ts",
      position: { line: 34, character: 13 },
    }),
  );
  // An overloaded call, cursor in the second argument: the answer must say
  // which overload is in use and mark the parameter being written.
  scenarioTest("overload-and-second-argument", ({ capture }) =>
    capture("signature_help", {
      file: "packages/accounts/tests/journal.test.ts",
      position: { line: 9, character: 5 },
    }),
  );
});

// ── inlay_hints: the types the source does not write ────────────────────────
describe("inlay_hints", () => {
  scenarioTest("inferred-types-in-a-loop", ({ capture }) =>
    capture("inlay_hints", {
      file: "packages/reports/src/balance.ts",
      range: { start: { line: 28, character: 1 }, end: { line: 37, character: 1 } },
    }),
  );
});

// ── selection_ranges: the structural nest an editor expands through ─────────
describe("selection_ranges", () => {
  scenarioTest("expression-to-file", ({ capture }) =>
    capture("selection_ranges", {
      file: "packages/reports/src/balance.ts",
      position: { line: 34, character: 20 },
    }),
  );
});

// ── project_config: which tsconfig owns this file ───────────────────────────
describe("project_config", () => {
  scenarioTest("package-ownership", ({ capture }) =>
    capture("project_config", { file: "packages/reports/src/balance.ts" }),
  );
});

// ── organize_imports: sort, merge, and drop what is unused ──────────────────
describe("organize_imports", () => {
  scenarioTest("messy-import-block", ({ capture }) =>
    capture("organize_imports", { file: "packages/importers/src/csv.ts" }),
  );
});

// ── remove_unused_code: the dead weight, as a patch ─────────────────────────
describe("remove_unused_code", () => {
  scenarioTest("dead-helpers", ({ capture }) =>
    capture("remove_unused_code", { file: "packages/importers/src/dedupe.ts" }),
  );
});

// ── format_document: mangled source, normalized ─────────────────────────────
describe("format_document", () => {
  scenarioTest("mangled-file", ({ capture }) =>
    capture("format_document", { file: "packages/importers/src/dedupe.ts" }),
  );
});

// ── add_missing_imports: the names a file forgot to import ──────────────────
describe("add_missing_imports", () => {
  scenarioTest("forgotten-imports", ({ capture }) =>
    capture("add_missing_imports", { file: "packages/reconcile/src/matching.ts" }),
  );
});

// ── code_actions: what the language service offers at a problem ─────────────
describe("code_actions", () => {
  scenarioTest("at-a-type-error", ({ capture }) =>
    capture("code_actions", {
      file: "packages/reconcile/src/drift.ts",
      range: { start: { line: 21, character: 65 }, end: { line: 21, character: 70 } },
    }),
  );
});

// ── rename_files: a move, with every import updated ─────────────────────────
describe("rename_files", () => {
  scenarioTest("module-move-updates-importers", ({ capture }) =>
    capture("rename_files", {
      files: [
        {
          from: "packages/accounts/src/posting.ts",
          to: "packages/accounts/src/entry-side.ts",
        },
      ],
    }),
  );
});

// ── rename_symbol: a reviewable patch, never a silent write ─────────────────
describe("rename_symbol", () => {
  scenarioTest("rename-across-packages", ({ capture }) =>
    capture("rename_symbol", {
      file: "packages/accounts/src/account.ts",
      position: { line: 18, character: 14 },
      newName: "balanceSide",
    }),
  );
  scenarioTest("class-rename-within-project", ({ capture }) =>
    capture("rename_symbol", {
      file: "packages/accounts/src/account.ts",
      position: { line: 37, character: 14 },
      newName: "InMemoryAccountStore",
    }),
  );
});

// ── impact: weigh a change before making it ─────────────────────────────────
describe("impact", () => {
  scenarioTest("weigh-a-change-to-signed-amount", ({ capture }) =>
    capture("impact", {
      file: "packages/accounts/src/posting.ts",
      position: { line: 25, character: 14 },
    }),
  );
  scenarioTest("weigh-a-change-to-a-shared-type", ({ capture }) =>
    capture("impact", {
      file: "packages/money/src/money.ts",
      position: { line: 12, character: 13 },
    }),
  );
});

// ── file_references: who imports this module ────────────────────────────────
describe("file_references", () => {
  scenarioTest("who-imports-money", ({ capture }) =>
    capture("file_references", { file: "packages/money/src/money.ts" }),
  );
});

// ── document_links: what this document points at ────────────────────────────
describe("document_links", () => {
  scenarioTest("json-schema-reference", ({ capture }) =>
    capture("document_links", { file: "ledger.config.json" }),
  );
});

// ── verify_edit: the diagnostics a change would cause, before it lands ──────
describe("verify_edit", () => {
  scenarioTest("proposed-edit-breaks-a-consumer", ({ capture }) =>
    capture("verify_edit", {
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
            '  readonly [brand]: "Money";',
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
    }),
  );
});

// ── compose: one authored document, several questions, one answer ───────────
describe("compose", () => {
  scenarioTest("settlement-dossier", ({ capture }) =>
    capture("compose", {
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
    }),
  );
});

// ── investigate_code: ranked retrieval with verified relationships ──────────
describe("investigate_code", () => {
  // A behavioral question the fixture genuinely answers: retrieval should
  // surface the balance roll-up and anchor its symbol with relationships.
  scenarioTest("behavioral-question-lands", ({ capture }) =>
    capture("investigate_code", {
      question: "how are account balances rolled up to ancestor accounts",
    }));
  // A concept the fixture does not contain: the honest shape is a weak or
  // empty answer that says so — not an unrelated symbol dressed in verified
  // relationships.
  scenarioTest("absent-concept-stays-absent", ({ capture }) =>
    capture("investigate_code", {
      question: "where is the retry backoff for failed network requests configured",
    }));
});

// ── explore_symbol: exact relationships plus similar code ───────────────────
describe("explore_symbol", () => {
  scenarioTest("function-with-similarity-tail", ({ capture }) =>
    capture("explore_symbol", {
      file: "packages/reports/src/balance.ts",
      symbol: "balancesAsOf",
    }));
});

// ── occurrences: literal proof of presence and absence ──────────────────────
describe("occurrences", () => {
  scenarioTest("token-found-across-packages", ({ capture }) =>
    capture("occurrences", { text: "signedAmount" }),
  );
  scenarioTest("honest-zero", ({ capture }) => capture("occurrences", { text: "quantumFlux" }));
});

// ── the hazard corner, deliberately last ────────────────────────────────────
// document_links on the unowned README plus find_successor put the bridge's
// host data into a state the next program rebuild does not survive
// (`createTsgoProgram` exits; docs/issues.md carries the minimal reproducer).
// Until that upstream defect falls, these run after every scenario that
// would otherwise die downstream of them — their own captures are sound.
describe("the hazard corner", () => {
  scenarioTest("fixture-readme", ({ capture }) => capture("document_links", { file: "README.md" }));
  scenarioTest("renamed-method-hunch", ({ capture }) =>
    capture("find_successor", {
      file: "packages/accounts/src/journal.ts",
      name: "postEntry",
    }),
  );
  scenarioTest("close-miss-finds-the-successor", ({ capture }) =>
    capture("find_successor", {
      file: "packages/reports/src/balance.ts",
      name: "balanceOf",
    }),
  );
  // Declarations that live only in test files are residue, not a capability
  // — the answer must say so instead of "this name resolves".
  scenarioTest("test-residue-is-not-a-capability", ({ capture }) =>
    capture("find_successor", {
      file: "packages/money/src/money.ts",
      name: "assertRoundingParity",
    }),
  );
});

/**
 * The corpus's table of contents, in execution order — what documentation
 * and distribution replay enumerate. Registered last so every capture has
 * run; on a name-filtered (`-t`) run it either skips or would shrink the
 * manifest, so regeneration is only truthful on a full run.
 */
test("capture manifest", async () => {
  if (capturedIds.size === 0) {
    throw new Error("No captures ran — refusing to snapshot an empty manifest.");
  }
  await expect(`${[...capturedIds].join("\n")}\n`).toMatchFileSnapshot("responses/manifest.txt");
});
