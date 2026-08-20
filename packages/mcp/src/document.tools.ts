import {
  DocumentDiagnosticRequest,
  GetMatchTsConfigRequest,
} from "@volar/language-server/protocol.js";
import type {
  Diagnostic,
  DocumentSymbol,
  SelectionRange,
  SymbolInformation,
} from "@volar/language-server/protocol.js";
import {
  codeFrame,
  createTypeAtlas,
  declarationChainAtPosition,
  documentSymbols,
  type Row,
  page,
  truncate,
  projectDocumentSymbols,
  renderDocument,
} from "@type-atlas/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { requestDiagnosticContext, workspaceRelativeMessage } from "./ambient-diagnostics.ts";
import { enclosingDeclaration } from "./reference-groups.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { defaultDimensions, positionText, rangeText, sameRange, displayPath } from "atlascii";
import * as path from "pathe";
import { URI } from "vscode-uri";
import { appendDiagnosticContext, textResult } from "./mcp-result.ts";
import { registerTool } from "./tool.ts";
import { fileInput, observedFileInput, positionInput, positionsInput } from "./tool-input.ts";
import type { VolarWorkspacePool } from "@type-atlas/core";

const input = type.module({
  Diagnostics: type({
    workspace: fileInput.workspace,
    "file?": type("string >= 1").configure({
      description:
        "Report on this one file instead: every diagnostic of every severity, problems before hints. project and scope are ignored when this is given.",
    }),
    "project?": type("string >= 1").configure({
      description:
        "Which TypeScript project to check, named by its directory or by any path inside it. Only needed when nothing has changed yet; the changed files choose the project otherwise.",
    }),
    "scope?": type.enumerated("changed", "project").configure(
      {
        default: "changed",
        description:
          "changed (files written since this workspace opened, the default) or project (every file in the projects owning them).",
      },
      "self",
    ),
    "offset?": type("number.integer >= 0").configure({
      description: "First diagnostic returned.",
    }),
    "limit?": type("1 <= number.integer <= 1000").configure({
      default: 100,
      description: "Maximum diagnostics returned.",
    }),
  }),
  File: type(fileInput),
  DocumentLinks: type(observedFileInput),
  DocumentSymbols: type({
    ...observedFileInput,
    "depth?": type("0 <= number.integer <= 10").configure({
      description:
        "Levels of nested symbols to include. Defaults to top-level declarations only, which is usually what an agent wants.",
    }),
    "raw?": type("boolean").configure({
      description:
        "Return the complete symbol hierarchy, including object properties and anonymous callbacks. Potentially far larger than the source file.",
    }),
  }),
  // `position` is one position on every tool of this surface; this was the
  // lone tool where the singular name took an array, and a bare
  // { line, character } — the common ask — was refused. A property cannot be
  // a choice (clients coerce a choice-typed value to a string), so the
  // together-ask is its own plural property.
  SelectionRanges: type({
    ...observedFileInput,
    "position?": positionInput,
    "positions?": positionsInput.configure(
      { description: "Several source positions to inspect together, instead of position." },
      "self",
    ),
  }),
});

export const registerDocumentTools = (server: McpServer, workspaces: VolarWorkspacePool): void => {
  registerTool(
    server,
    "diagnostics",
    {
      title: "Diagnostics",
      description:
        "Report diagnostics for the TypeScript projects you have touched — the compiler's own whole-program check, run once per project.",
      inputSchema: input.Diagnostics,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, project: named, scope = "changed", offset = 0, limit = 100 },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      // One file is a different question with the same answer shape: the
      // document pull the ambient context reads, every severity kept, worst
      // first — asked directly instead of by hovering whitespace for the
      // ambient block, which is what real audit work resorted to twice.
      const asked =
        file === undefined
          ? undefined
          : await (async () => {
              const { uri } = await workspace.getTextDocument(file);
              const [pulled, project] = await Promise.all([
                workspace.sendRequest(
                  DocumentDiagnosticRequest.type,
                  { textDocument: { uri } },
                  signal,
                ),
                workspace.sendRequest(GetMatchTsConfigRequest.type, { uri }, signal),
              ]);
              const items = (
                pulled && typeof pulled === "object" && "items" in pulled
                  ? ((pulled as { items: readonly Diagnostic[] }).items ?? [])
                  : []
              )
                .map((diagnostic) => ({ uri, diagnostic }))
                .sort(
                  (left, right) =>
                    (left.diagnostic.severity ?? 1) - (right.diagnostic.severity ?? 1) ||
                    left.diagnostic.range.start.line - right.diagnostic.range.start.line,
                );
              return { uri, items, project };
            })();
      const report = asked
        ? {
            diagnostics: asked.items,
            unchanged: false,
            projectCount: 1,
            fileCount: 1,
            affectedCount: asked.items.length > 0 ? 1 : 0,
            configFile: asked.project?.uri,
          }
        : await createTypeAtlas(workspace).diagnose({
            files: workspace.changedFiles(),
            project: named,
            scope,
            signal,
          });
      const shown = page(report.diagnostics, offset, limit);
      // Every located row names what stands there — the referent reference
      // rows already carry, bounded to the page.
      const owners = new Map(
        await Promise.all(
          shown.items.map(async ({ uri, diagnostic }) => {
            const chain = await declarationChainAtPosition({
              workspace,
              uri,
              position: diagnostic.range.start,
            }).catch(() => []);
            return [
              `${uri} ${diagnostic.range.start.line}:${diagnostic.range.start.character}`,
              enclosingDeclaration(chain, diagnostic.range)?.name,
            ] as const;
          }),
        ),
      );
      const sources = new Map<string, Promise<string>>();
      const sourceFor = (uri: string) => {
        const held = sources.get(uri);
        if (held) return held;
        const reading = workspace
          .readTextDocumentUri(uri, signal)
          .then(({ source }) => source)
          .catch(() => "");
        sources.set(uri, reading);
        return reading;
      };
      // The codes summary only earns its place when a page hides most of the
      // report and the problems are not all the same one.
      const byCode = Map.groupBy(
        report.diagnostics,
        ({ diagnostic }) => `${diagnostic.source ?? "typescript"}(${diagnostic.code})`,
      );
      const codes =
        shown.total > shown.items.length && byCode.size > 1
          ? [...byCode]
              .sort(([, left], [, right]) => right.length - left.length)
              .slice(0, 8)
              .map(([code, items]) => [
                String(items.length),
                code,
                truncate({
                  value: workspaceRelativeMessage(
                    (items[0]?.diagnostic.message.split("\n")[0] ?? "").replace(/\s+/g, " "),
                    root,
                  ),
                  columns: defaultDimensions.summaryColumns,
                }),
              ])
          : [];
      // Drawn before the document renders, because a frame is source a document
      // has no way to read.
      const frames = new Map(
        await Promise.all(
          shown.items.map(
            async ({ uri, diagnostic }) =>
              [
                // The full range keys the frame: two problems on one line each
                // deserve their own caret, and a line-keyed map handed the
                // second problem the first one's underline.
                `${uri} ${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.range.end.character}`,
                await sourceFor(uri).then((text) =>
                  text
                    ? codeFrame({
                        source: text,
                        line: diagnostic.range.start.line + 1,
                        character: diagnostic.range.start.character + 1,
                        end: {
                          line: diagnostic.range.end.line + 1,
                          character: diagnostic.range.end.character + 1,
                        },
                      })
                    : "",
                ),
              ] as const,
          ),
        ),
      );
      const rendered = await renderDocument({
        document: "diagnostics.tool.mdoc",
        variables: {
          oneFile: asked ? displayPath(asked.uri, root) : undefined,
          problemCount: asked
            ? asked.items.filter(({ diagnostic }) => (diagnostic.severity ?? 1) <= 2).length
            : undefined,
          hintCount: asked
            ? asked.items.filter(({ diagnostic }) => (diagnostic.severity ?? 1) > 2).length
            : undefined,
          unchanged: report.unchanged,
          unloaded: !asked && !report.unchanged && !report.projectCount,
          checked: !asked && !report.unchanged && report.projectCount > 0,
          // The scope word follows the actual selection, not the argument: a
          // named project is checked whole regardless of scope, and "Changed
          // files · 203 files checked" read as a contradiction.
          wholeProject: scope !== "changed" || named !== undefined,
          total: shown.total,
          // `shown` counted the page's distinct files while the page line below
          // counted its diagnostics, so one answer carried `3 shown` above
          // `6 shown`. The header states what was found and where; the page line
          // is the only place that says how much of it is on screen.
          affected: report.affectedCount,
          fileCount: report.fileCount,
          manyProjects: report.projectCount > 1,
          projectCount: report.projectCount,
          configFile: report.configFile ? displayPath(report.configFile, root) : undefined,
          root,
          page:
            shown.offset + shown.items.length < shown.total
              ? {
                  from: shown.offset + 1,
                  to: shown.offset + shown.items.length,
                  total: shown.total,
                  next: shown.nextOffset,
                  unit: "problems",
                }
              : undefined,
          // Naming only the total made a list of eight look like the whole set
          // of eighteen.
          codePage:
            codes.length < byCode.size ? { shown: codes.length, total: byCode.size } : undefined,
          codeTotal: byCode.size,
          codes,
          codeColumns: [{ align: "end" }, {}, {}],
          // The file leads its own group. Repeating a path on every row costs
          // more than it tells, and a report usually names a handful of files
          // holding many problems each.
          groups: [...Map.groupBy(shown.items, ({ uri }) => displayPath(uri, root))].map(
            ([file, items]) => ({
              file,
              problems: items.map(({ uri, diagnostic }) => ({
                severity: diagnostic.severity,
                source: diagnostic.source,
                code: diagnostic.code,
                range: diagnostic.range,
                within: owners.get(
                  `${uri} ${diagnostic.range.start.line}:${diagnostic.range.start.character}`,
                ),
                message: workspaceRelativeMessage(diagnostic.message, root),
                frame:
                  frames.get(
                    `${uri} ${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.range.end.character}`,
                  ) || undefined,
              })),
            }),
          ),
        },
      });
      return textResult(rendered.text);
    },
  );

  registerTool(
    server,
    "document_links",
    {
      title: "Document links",
      description:
        "Return resolved links discovered by the active language service in a Markdown or JSON document.",
      inputSchema: input.DocumentLinks,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file, includeDiagnostics }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const intelligence = createTypeAtlas(workspace);
      const { textDocument, links } = await intelligence.documentLinks(file, signal);
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      const found = links ?? [];
      const rendered = await renderDocument({
        document: "document-links.tool.mdoc",
        variables: {
          file: displayPath(textDocument.uri, root),
          root,
          answered: links !== null && links !== undefined,
          total: found.length,
          groups: found.length
            ? [
                {
                  file: displayPath(textDocument.uri, root),
                  // `children`, the key the tree partial walks — `rows` was a
                  // name nothing read, so a document "naming 2 links" rendered
                  // a bare group header and no link ever appeared.
                  children: found.map((link) => ({
                    selection: link.range,
                    // A target beyond the workspace shows the way the author
                    // wrote it — relative to the document — never as a
                    // machine-absolute path.
                    text: link.target
                      ? (() => {
                          const shown = displayPath(link.target, root);
                          return path.isAbsolute(shown) && link.target.startsWith("file:")
                            ? path.relative(
                                path.dirname(URI.parse(textDocument.uri).fsPath),
                                URI.parse(link.target).fsPath,
                              )
                            : shown;
                        })()
                      : "unresolved",
                  })),
                },
              ]
            : [],
        },
      });
      return appendDiagnosticContext(textResult(rendered.text), await diagnosticContext);
    },
  );

  registerTool(
    server,
    "document_symbols",
    {
      title: "Document symbols",
      description:
        "Return the top-level document outline and source ranges. Set depth to include nested symbols or raw to return the complete hierarchy.",
      inputSchema: input.DocumentSymbols,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, depth = 0, raw = false, includeDiagnostics },
      { mcpReq: { signal } },
    ) => {
      const workspace = await workspaces.get(root);
      // The outline is parsed from the text, so this asks nothing of the
      // language server and answers for a file no TypeScript project owns —
      // which is exactly what the refusal for those files points a reader to.
      // Resolving the document the semantic way would refuse it here too.
      const textDocument = { uri: workspace.getWorkspaceUri(file) };
      const { source } = await workspace.readTextDocumentUri(textDocument.uri, signal);
      const symbols = documentSymbols({ uri: textDocument.uri, source });
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      const parsed = symbols ?? [];
      const output = raw ? parsed : projectDocumentSymbols([...parsed], depth);
      // An outline is already a tree, so it is handed over as one: a document
      // states what a row says and the guide draws how deep it sits, and
      // neither needs a depth counted onto every entry to get there.
      const outline = (function nestOutline(
        entries: readonly (DocumentSymbol | SymbolInformation)[],
      ): readonly Record<string, unknown>[] {
        return entries.map((entry) => {
          const selection = "range" in entry ? entry.selectionRange : entry.location.range;
          const extent = "range" in entry ? entry.range : entry.location.range;
          return {
            name: entry.name,
            // The number, not the word. Which word stands for kind 12 belongs
            // to the message catalog the document reaches, and a handler that
            // resolves it first puts the answer beyond renaming.
            kind: entry.kind,
            selection,
            extent: sameRange(extent, selection) ? undefined : extent,
            detail: "detail" in entry ? entry.detail : undefined,
            children: "range" in entry ? nestOutline(entry.children ?? []) : [],
          };
        });
      })(output ?? []);
      const rendered = await renderDocument({
        document: "document-symbols.tool.mdoc",
        variables: {
          file: displayPath(textDocument.uri, root),
          answered: symbols !== undefined,
          total: (output ?? []).length,
          outline,
        },
      });
      return appendDiagnosticContext(textResult(rendered.text), await diagnosticContext);
    },
  );

  registerTool(
    server,
    "selection_ranges",
    {
      title: "Selection ranges",
      description:
        "Return the nested structural ranges an editor expands through from one or more source positions.",
      inputSchema: input.SelectionRanges,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace: root, file, position, positions: several, includeDiagnostics },
      { mcpReq: { signal } },
    ) => {
      if ((position === undefined) === (several === undefined)) {
        throw new Error(
          position === undefined
            ? "Pass position, or positions for several at once."
            : "position and positions are one ask twice — pass one of them.",
        );
      }
      const workspace = await workspaces.get(root);
      const positions = several ?? [position!];
      const intelligence = createTypeAtlas(workspace);
      const { textDocument, result: ranges } = await intelligence.selectionRanges({
        file,
        signal,
        params: { positions: [...positions] },
      });
      const diagnosticContext = requestDiagnosticContext(
        workspace,
        textDocument,
        root,
        includeDiagnostics,
        signal,
      );
      // A selection expands outward from a position, so each step contains the
      // one before it. `children` is how that nesting is expressed to a row;
      // a flat list carrying a `depth` field rendered every step at the same
      // indent, because `Row` has no `depth` and the tag dropped it.
      const chain = (selection: SelectionRange | undefined): Row[] =>
        selection ? [{ name: rangeText(selection.range), children: chain(selection.parent) }] : [];
      const steps = (selection: SelectionRange | undefined): number =>
        selection ? 1 + steps(selection.parent) : 0;
      const total = (ranges ?? []).reduce((sum, selection) => sum + steps(selection), 0);
      const rendered = await renderDocument({
        document: "selection-ranges.tool.mdoc",
        variables: {
          file: displayPath(textDocument.uri, root),
          root,
          total,
          fromCount: positions.length,
          chains: (ranges ?? []).map((selection, index) => ({
            name: positionText(positions[index]!),
            children: chain(selection),
          })),
        },
      });
      return appendDiagnosticContext(textResult(rendered.text), await diagnosticContext);
    },
  );

  registerTool(
    server,
    "project_config",
    {
      title: "Project configuration",
      description: "Return the TypeScript configuration selected for a source file.",
      inputSchema: input.File,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace: root, file }, { mcpReq: { signal } }) => {
      const workspace = await workspaces.get(root);
      const textDocument = await workspace.getTextDocument(file);
      const result = await workspace.sendRequest(
        GetMatchTsConfigRequest.type,
        textDocument,
        signal,
      );
      const rendered = await renderDocument({
        document: "project-config.tool.mdoc",
        variables: {
          // Workspace-relative, like every path this surface answers —
          // diagnostics names these very tsconfigs relatively, and one tool
          // answering absolute contradicted the surface's own contract.
          project: result ? displayPath(result.uri, root) : undefined,
        },
      });
      return textResult(rendered.text);
    },
  );
};
