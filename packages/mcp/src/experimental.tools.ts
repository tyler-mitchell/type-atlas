import type { McpServer } from "@modelcontextprotocol/server";
import {
  type Diagnostic,
  DocumentDiagnosticRequest,
  GetMatchTsConfigRequest,
} from "@volar/language-server/protocol.js";
import {
  createTypeAtlas,
  declarationAtPosition,
  renderDocument,
  type VolarWorkspacePool,
} from "@type-atlas/core";
import { type } from "arktype";
import { displayPath } from "atlascii";
import { textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { createQuorl } from "./quorl.ts";
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
            .search({ repo: root, query: declaration.name, limit: 20, signal })
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
            .search({ repo: root, query: `${declaration?.name ?? ""} ${name}`, limit: 3, signal })
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
