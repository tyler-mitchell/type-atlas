import type { McpServer } from "@modelcontextprotocol/server";
import {
  type Diagnostic,
  type DocumentSymbol,
  DocumentDiagnosticRequest,
  GetMatchTsConfigRequest,
  type SymbolInformation,
} from "@volar/language-server/protocol.js";
import {
  createTypeAtlas,
  declarationAtPosition,
  declarationChainAtPosition,
  documentSymbols,
  renderComposition,
  renderDocument,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { type } from "arktype";
import { displayPath, markupText, sameRange } from "atlascii";
import { type DocumentAsk, documentAsks } from "atlascii/document";
import { textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { createQuorl } from "./quorl.ts";
import { enclosingDeclaration, referenceGroups } from "./reference-groups.ts";
import type { Semble } from "./semble.ts";
import { registerTool } from "./tool.ts";
import { fileInput, positionInput } from "./tool-input.ts";

const input = type.module({
  Quorl: type({
    ...fileInput,
    position: positionInput.configure(
      { description: "Position of the symbol whose closure should be expanded." },
      "self",
    ),
    "depth?": type("1 <= number.integer <= 4").configure({
      default: 2,
      description: "How many hops of enclosing declarations to follow.",
    }),
    "limit?": type("1 <= number.integer <= 200").configure({
      default: 40,
      description: "Maximum declarations expanded before the rest are reported as a frontier.",
    }),
  }),
  Impact: type({
    ...fileInput,
    position: positionInput.configure(
      { description: "Position of the symbol whose change is being weighed." },
      "self",
    ),
  }),
  VerifyEdit: type({
    workspace: fileInput.workspace,
    files: type({
      path: type("string >= 1").describe("Workspace-relative or absolute file path."),
      content: type("string").describe("The file's complete proposed content."),
    })
      .array()
      .atLeastLength(1)
      .atMostLength(5)
      .configure(
        { description: "Proposed contents to check, before anything is written." },
        "self",
      ),
  }),
  Compose: type({
    workspace: fileInput.workspace,
    document: type("string >= 1").configure({
      description:
        "Markdoc source: ask declarations followed by a body composing what they bind.",
    }),
  }),
});

/** One diagnostic's identity across an edit, where ranges shift but meaning holds. */
const diagnosticKey = (entry: {
  readonly severity?: number;
  readonly code?: number | string;
  readonly message: string;
}) => `${entry.severity ?? 1}|${entry.code ?? ""}|${entry.message}`;

/** The workspace package a display path belongs to, as a reader names it. */
const packageOf = (file: string) => {
  const segments = file.split("/");
  return segments.length === 1
    ? "workspace root"
    : segments[0] === "packages" || segments[0] === "apps"
      ? segments.slice(0, 2).join("/")
      : (segments[0] ?? "workspace root");
};

/** Whether a use sits in a test file, by the paths tests conventionally hold. */
const isTestSite = (file: string) => /(^|\/)tests?\/|\.(test|spec|check)\./u.test(file);

export const registerExperimentalTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
  semble: Semble,
): void => {
  const quorl = createQuorl({ workspaces });

  registerTool(
    server,
    "verify_edit",
    {
      title: "Verify edit",
      description:
        "Experimental: the diagnostics a proposed edit would introduce, before anything is written. Each file's complete proposed content is checked in memory against the file as it stands; the answer reports what the change introduces and resolves in those files. A change can also break importers — diagnostics after applying reports those.",
      inputSchema: input.VerifyEdit,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, files }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const checked = await Promise.all(
        files.map(async ({ path: file, content }) => {
          const { uri } = await workspace.getTextDocument(file);
          const report = (result: unknown) =>
            result && typeof result === "object" && "items" in result
              ? ((result as { items: readonly Diagnostic[] }).items ?? [])
              : [];
          const baseline = report(
            await workspace.sendRequest(DocumentDiagnosticRequest.type, {
              textDocument: { uri },
            }, signal),
          ).filter((entry) => (entry.severity ?? 1) <= 2);
          const proposed = await workspace.withTextDocument({
            uri,
            languageId: "typescript",
            source: content,
            signal,
            task: async (textDocument) =>
              report(
                await workspace.sendRequest(DocumentDiagnosticRequest.type, {
                  textDocument,
                }, signal),
              ).filter((entry) => (entry.severity ?? 1) <= 2),
          });
          const standing = new Map<string, number>();
          for (const entry of baseline) {
            standing.set(diagnosticKey(entry), (standing.get(diagnosticKey(entry)) ?? 0) + 1);
          }
          const introduced = proposed.filter((entry) => {
            const held = standing.get(diagnosticKey(entry)) ?? 0;
            if (held === 0) return true;
            standing.set(diagnosticKey(entry), held - 1);
            return false;
          });
          const resolved = [...standing.values()].reduce((total, count) => total + count, 0);
          return {
            file: displayPath(uri, root),
            introduced: introduced.map((entry) => ({
              severity: entry.severity,
              source: entry.source,
              code: entry.code,
              range: entry.range,
              message: entry.message,
            })),
            resolvedCount: resolved,
          };
        }),
      );
      const rendered = await renderDocument({
        document: "verify-edit.tool.mdoc",
        variables: {
          fileCount: checked.length,
          introducedCount: checked.reduce((total, { introduced }) => total + introduced.length, 0),
          resolvedCount: checked.reduce((total, { resolvedCount }) => total + resolvedCount, 0),
          groups: checked
            .filter(({ introduced }) => introduced.length > 0)
            .map(({ file, introduced }) => ({ file, problems: introduced })),
        },
      });
      return textResult(rendered.text);
    },
  );

  registerTool(
    server,
    "compose",
    {
      title: "Compose",
      description:
        'Experimental: author and compose your own code-intelligence queries in markup. A document of self-closing ask tags is a complete composition — each answer renders in its canonical block, in your order. Add body markup only to shape the answer yourself: what an ask binds is readable anywhere below it ({% $uses.total %}), and the shipped tags and partials compose it.\n\nOperations and what each binds:\n- {% ask "hover" as="head" file="src/x.ts" line=5 character=10 /%} (one-based, on the symbol\'s name) → {text}: the signature and documentation, rendered with {% $head.text %}\n- {% ask "references" as="uses" file="src/x.ts" line=5 character=10 /%} → {total, files, projects, groups}; render sites with {% tree entries=$uses.groups partial="reference-node.mdoc" /%}\n- {% ask "outline" as="shape" file="src/x.ts" /%} → {total, tree}; render with {% tree entries=$shape.tree partial="symbol-node.mdoc" /%}\n- {% ask "diagnostics" as="problems" file="src/x.ts" /%} → {total, groups}; render with {% each items=$problems.groups as="group" partial="diagnostic-group.mdoc" /%}\n- {% ask "source" as="body" file="src/x.ts" from=10 to=40 /%} → {lines, startLine}; render with {% source lines=$body.lines startLine=$body.startLine /%}',
      inputSchema: input.Compose,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, document }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      const askedFile = (ask: DocumentAsk) => String(ask.attributes.file ?? "");
      // Ask positions are one-based, like every position this surface accepts.
      const askedPosition = (ask: DocumentAsk) => ({
        line: Number(ask.attributes.line ?? 1) - 1,
        character: Number(ask.attributes.character ?? 1) - 1,
      });
      // The operations a composition can ask for, each binding the shape its
      // partial reads — the same shapes the dedicated tools compose from.
      const operations: Record<string, (ask: DocumentAsk) => Promise<unknown>> = {
        hover: async (ask) => {
          const { result } = await intelligence.hover({
            file: askedFile(ask),
            signal,
            params: { position: askedPosition(ask) },
          });
          return { text: markupText(result?.contents) ?? "" };
        },
        references: async (ask) => {
          const { result, projects } = await intelligence.references({
            file: askedFile(ask),
            signal,
            params: {
              position: askedPosition(ask),
              context: { includeDeclaration: false },
              scope: "workspace",
            },
          });
          const sites = [];
          for (const { uri, range } of result ?? []) {
            const chain = await declarationChainAtPosition({
              workspace,
              uri,
              position: range.start,
            }).catch(() => []);
            sites.push({
              file: displayPath(uri, root),
              line: range.start.line + 1,
              character: range.start.character + 1,
              within: enclosingDeclaration(chain, range)?.name,
            });
          }
          const ordered = [...sites].sort(
            (left, right) =>
              left.file.localeCompare(right.file) ||
              left.line - right.line ||
              left.character - right.character,
          );
          return {
            total: ordered.length,
            files: new Set(ordered.map(({ file }) => file)).size,
            projects,
            groups: referenceGroups(ordered),
          };
        },
        outline: async (ask) => {
          const uri = workspace.getWorkspaceUri(askedFile(ask));
          const { source } = await workspace.readTextDocumentUri(uri, signal);
          const parsed = documentSymbols({ uri, source }) ?? [];
          const nest = (
            entries: readonly (DocumentSymbol | SymbolInformation)[],
          ): readonly Record<string, unknown>[] =>
            entries.map((entry) => {
              const selection = "range" in entry ? entry.selectionRange : entry.location.range;
              const extent = "range" in entry ? entry.range : entry.location.range;
              return {
                name: entry.name,
                kind: entry.kind,
                selection,
                extent: sameRange(extent, selection) ? undefined : extent,
                detail: "detail" in entry ? entry.detail : undefined,
                children: "range" in entry ? nest(entry.children ?? []) : [],
              };
            });
          return { total: parsed.length, tree: nest(parsed) };
        },
        diagnostics: async (ask) => {
          const { uri } = await workspace.getTextDocument(askedFile(ask));
          const report = await workspace.sendRequest(
            DocumentDiagnosticRequest.type,
            { textDocument: { uri } },
            signal,
          );
          const problems = (
            report && typeof report === "object" && "items" in report
              ? ((report as { items: readonly Diagnostic[] }).items ?? [])
              : []
          ).map((entry) => ({
            severity: entry.severity,
            source: entry.source,
            code: entry.code,
            range: entry.range,
            message: entry.message,
          }));
          return {
            total: problems.length,
            groups:
              problems.length > 0 ? [{ file: displayPath(uri, root), problems }] : [],
          };
        },
        source: async (ask) => {
          const uri = workspace.getWorkspaceUri(askedFile(ask));
          const { source } = await workspace.readTextDocumentUri(uri, signal);
          const lines = source.split("\n");
          const from = Number(ask.attributes.from ?? 1);
          return {
            lines: lines.slice(from - 1, Number(ask.attributes.to ?? lines.length)),
            startLine: from,
          };
        },
      };
      const asks = documentAsks(document);
      const unfulfillable = asks.filter(({ operation }) => !(operation in operations));
      if (unfulfillable.length > 0) {
        throw new Error(
          `This composition asks for ${unfulfillable
            .map(({ operation }) => `"${operation}"`)
            .join(", ")}; the operations are ${Object.keys(operations).join(", ")}.`,
        );
      }
      const bound = Object.fromEntries(
        await Promise.all(
          asks.map(async (ask) => [ask.bind, await operations[ask.operation]!(ask)] as const),
        ),
      );
      // The markup is the query language, so a body is optional: a document
      // of bare asks renders each answer in its canonical block, and an
      // authored body takes over only when the composer wants the shaping.
      const subject = (ask: DocumentAsk) =>
        [ask.attributes.file, ask.attributes.line, ask.attributes.character]
          .filter((part) => part !== undefined)
          .join(":");
      const canonicalSection: Record<string, (ask: DocumentAsk) => string> = {
        hover: (ask) => `## ${subject(ask)}\n\n{% $${ask.bind}.text %}`,
        references: (ask) =>
          `## References — ${subject(ask)}\n\n{% $${ask.bind}.total %} uses in {% $${ask.bind}.files %} files, across {% $${ask.bind}.projects %} projects.\n\n{% tree entries=$${ask.bind}.groups partial="reference-node.mdoc" /%}`,
        outline: (ask) =>
          `## Outline — ${subject(ask)}\n\n{% tree entries=$${ask.bind}.tree partial="symbol-node.mdoc" /%}`,
        diagnostics: (ask) =>
          `## Problems — ${subject(ask)}\n\n{% if equals($${ask.bind}.total, 0) %}No problem in this file.{% /if %}\n{% each items=$${ask.bind}.groups as="group" partial="diagnostic-group.mdoc" /%}`,
        source: (ask) =>
          `## ${subject(ask)}\n\n{% source lines=$${ask.bind}.lines startLine=$${ask.bind}.startLine /%}`,
      };
      const bare = document.replace(/\{%\s*ask\b[\s\S]*?\/%\}/gu, "").trim() === "";
      const source =
        bare && asks.length > 0
          ? `${document}\n\n${asks.map((ask) => canonicalSection[ask.operation]!(ask)).join("\n\n")}`
          : document;
      const rendered = await renderComposition({ source, variables: bound });
      // A name the body reads that no ask bound renders as a hole; naming it is
      // the feedback a composer can act on.
      return textResult(
        rendered.undefinedVariables.length > 0
          ? `${rendered.text}\n\nUndefined in this composition: ${[
              ...new Set(rendered.undefinedVariables),
            ].join(", ")} — the asks bind ${asks.map(({ bind }) => bind).join(", ") || "nothing"}.`
          : rendered.text,
      );
    },
  );

  registerTool(
    server,
    "impact",
    {
      title: "Impact",
      description:
        "Experimental: weigh a change to the symbol at a position — every use, grouped by package, with how many sit in tests. Loads the projects of consumers retrieval can see, so the answer reaches past what this session happened to touch. Composed for the decision, not the enumeration; references lists the sites themselves.",
      inputSchema: input.Impact,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, position }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      const declaration = await declarationAtPosition({
        workspace,
        uri: workspace.getWorkspaceUri(file),
        position,
      }).catch(() => undefined);
      // A decision needs the whole blast radius, and the reference fan-out
      // reaches only projects something already loaded. Retrieval sees the
      // name across the entire repository, so packages it names that no
      // loaded project covers get loaded first — project selection for one
      // of their files is the load — bounded to a handful so one question
      // cannot demand every project in a monorepo.
      const consumerBudget = 4;
      const candidates = declaration?.name
        ? await semble
            .search({ repo: root, query: declaration.name, limit: 20, snippetLines: 0, signal })
            .then(({ results }) =>
              [
                ...new Set(
                  results
                    .map(({ file_path }) => packageOf(file_path))
                    .filter((name) => name !== packageOf(displayPath(workspace.getWorkspaceUri(file), root))),
                ),
              ].slice(0, consumerBudget),
            )
            .catch(() => [])
        : [];
      const loaded = await Promise.all(
        candidates.map((name) =>
          semble
            .search({
              repo: root,
              query: `${declaration?.name ?? ""} ${name}`,
              limit: 3,
              snippetLines: 0,
              signal,
            })
            .then(async ({ results }) => {
              const inside = results.find(({ file_path }) => packageOf(file_path) === name);
              if (!inside) return undefined;
              await workspace.sendRequest(
                GetMatchTsConfigRequest.type,
                { uri: workspace.getWorkspaceUri(inside.file_path) },
                signal,
              );
              return name;
            })
            .catch(() => undefined),
        ),
      );
      const { result: references } = await intelligence.references({
        file,
        signal,
        params: { position, context: { includeDeclaration: false }, scope: "workspace" },
      });
      const sites = (references ?? []).map(({ uri }) => displayPath(uri, root));
      const explored = new Set(loaded.filter((name) => name !== undefined));
      const byPackage = Map.groupBy(sites, packageOf);
      const rows = [...byPackage]
        .map(([name, held]) => ({
          name,
          uses: held.length,
          files: new Set(held).size,
          tests: held.filter(isTestSite).length,
        }))
        .sort((left, right) => right.uses - left.uses);
      const rendered = await renderDocument({
        document: "impact.tool.mdoc",
        variables: {
          subject: declaration?.name ?? "the symbol at this position",
          answered: references !== null,
          total: sites.length,
          fileCount: new Set(sites).size,
          packageCount: rows.length,
          testCount: rows.reduce((total, { tests }) => total + tests, 0),
          // Named by retrieval, not loaded or not confirming a use — the
          // characterised remainder a decision still has to weigh.
          beyond: candidates.filter(
            (name) => !explored.has(name) && !rows.some((row) => row.name === name),
          ),
          columns: [{}, { align: "end" }, { align: "end" }, { align: "end" }],
          rows: rows.map(({ name, uses, files, tests }) => [
            name,
            String(uses),
            String(files),
            tests ? String(tests) : "",
          ]),
        },
      });
      return textResult(rendered.text);
    },
  );

  registerTool(
    server,
    "quorl",
    {
      title: "Quorl",
      description:
        "Expand the transitive reference closure of a symbol, breadth-first, reporting every site with its source line and the declaration enclosing it, plus the frontier that was not expanded. Use before removing or replacing something, when you need the whole blast radius rather than one hop.",
      inputSchema: input.Quorl,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace, file, position, depth = 2, limit = 40 }, { mcpReq: { signal } }) =>
      textResult(await quorl({ workspace, file, position, depth, limit, signal })),
  );
};
