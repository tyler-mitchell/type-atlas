import { readdir, stat } from "node:fs/promises";
import * as path from "pathe";
import {
  ProjectDiagnosticsRequest,
  WorkspaceDeclarationsRequest,
  WorkspaceReferencesRequest,
} from "@type-atlas/language-server/protocol";
import {
  type CallHierarchyItem,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  DefinitionRequest,
  DocumentDiagnosticRequest,
  DocumentHighlightRequest,
  DocumentLinkRequest,
  DocumentLinkResolveRequest,
  DocumentSymbolRequest,
  GetMatchTsConfigRequest,
  HoverRequest,
  ImplementationRequest,
  type Position,
  ReferencesRequest,
  SelectionRangeRequest,
  TypeDefinitionRequest,
  WorkspaceSymbolRequest,
} from "@volar/language-server/protocol.js";
import type { Location, Range, RequestType } from "vscode-languageserver-protocol";
import { incomingCalls } from "./symbol-inspection.ts";
import type { VolarWorkspace } from "./volar-workspace.ts";

/** Which projects a reference search covers. */
export type ReferenceScope = "project" | "workspace";

const sourceCodeUri = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

/** A TypeScript or JavaScript project configuration, including `tsconfig.build.json`. */
const configFileName = /^[jt]sconfig(\..+)?\.json$/;

/**
 * A document that selects the project a caller named.
 *
 * A path inside a project is already one. A directory is not: the search starts
 * at the containing directory, so a directory reaches its parent's
 * configuration. Its own `src` is where a project's configuration points, and
 * one directory read there names a document the project includes — walking the
 * tree to be thorough would read a package to answer which config owns it.
 */
const projectDocument = async (workspace: VolarWorkspace, project: string) => {
  const projectPath = path.resolve(workspace.root, project);
  const isDirectory = await stat(projectPath).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
  // A configuration selects nothing: no project includes its own tsconfig, so
  // naming one resolved to a document no service owned, the request fell back
  // to every loaded project, and the inferred project the checker does not hold
  // ended it — `tsgoChecker: project not found for <root>/jsconfig.json`. The
  // directory holding the configuration is the project it configures.
  const directory = isDirectory ? projectPath : path.dirname(projectPath);
  if (!isDirectory && !configFileName.test(path.basename(projectPath))) return project;
  for (const candidate of [path.join(directory, "src"), directory]) {
    const entries = await readdir(candidate, { withFileTypes: true }).catch(() => []);
    const source = entries.find((entry) => entry.isFile() && sourceCodeUri.test(entry.name));
    if (source) return path.join(candidate, source.name);
  }
  throw new Error(
    `${project} holds no TypeScript source to select a project with. Name a file inside the project instead.`,
  );
};

/**
 * Matches generated declaration files.
 *
 * TypeScript's navigate-to API accepts `excludeDtsFiles`, but
 * `volar-service-typescript` calls `getNavigateToItems(query)` with no further
 * arguments and exposes no setting for them, so the choice cannot be made
 * upstream. Declarations are excluded here instead: a workspace package
 * consumed through its build output otherwise reports the generated
 * declaration next to the source it was generated from.
 */
const declarationUri = /\.d\.[cm]?ts$/i;

/**
 * Recovers the resource an editor command target encodes.
 *
 * `vscode-markdown-languageservice` resolves a link to a directory, or to a
 * file with a fragment, into a VS Code command URI rather than a plain target
 * (`out/languageFeatures/documentLinks.js:555` and `:562`). Those are
 * instructions to an editor host: they mean nothing outside a VS Code window,
 * and they carry the resource inside a percent-encoded JSON payload.
 *
 * The service takes no option to suppress them, and its plain-target API,
 * `resolveLinkTarget`, is not surfaced by `volar-service-markdown`, so the
 * encoding is reversed here. A target that cannot be recovered is dropped: an
 * agent cannot act on a command it has no host to run.
 */
const commandTargetResource = (target: string): string | undefined => {
  const separator = target.indexOf("?");
  if (!target.startsWith("command:") || separator < 0) return undefined;
  try {
    const payload: unknown = JSON.parse(decodeURIComponent(target.slice(separator + 1)));
    const resource = Array.isArray(payload) ? payload[0] : payload;
    const external = (resource as { readonly external?: unknown } | null)?.external;
    return typeof external === "string" ? external : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Creates project-aware language operations backed by an active workspace.
 *
 * File paths may be absolute or relative to the workspace root. Operations
 * observe filesystem changes through the workspace and honor cancellation
 * through the supplied signal. The caller retains ownership of the workspace.
 */
export const createTypeAtlas = (workspace: VolarWorkspace) => {
  /**
   * Asks the language server one positional request about one file.
   *
   * Every such request is the same three steps — resolve the document, send,
   * return both — so they are declared rather than written out. `shape` says
   * how the request wants its document: as `{ textDocument, ...rest }`, which
   * is what LSP defines, or as the identifier alone for the custom requests
   * this repository adds.
   */
  const ask =
    <Params, Result, Error>(
      request: RequestType<Params, Result, Error>,
      shape: "params" | "document" = "params",
    ) =>
    async (input: {
      readonly file: string;
      readonly signal: AbortSignal;
      readonly params?: Omit<Params, "textDocument">;
    }) => {
      const textDocument = await workspace.getTextDocument(input.file);
      const result = await workspace.sendRequest(
        request,
        (shape === "document" ? textDocument : { textDocument, ...input.params }) as Params,
        input.signal,
      );
      return { textDocument, result };
    };

  /**
   * Asks the call hierarchy about one position, in one direction.
   *
   * The protocol splits this in two — prepare a callable, then ask about it —
   * and a position can prepare more than one, so the second step is asked for
   * each.
   */
  const callHierarchy =
    <Call>(request: RequestType<{ readonly item: CallHierarchyItem }, Call[] | null, void>) =>
    async (input: {
      readonly file: string;
      readonly position: Position;
      readonly signal: AbortSignal;
    }) => {
      const textDocument = await workspace.getTextDocument(input.file);
      const items = await workspace.sendRequest(
        CallHierarchyPrepareRequest.type,
        { textDocument, position: input.position },
        input.signal,
      );
      return {
        textDocument,
        items,
        calls:
          items &&
          (await Promise.all(
            items.map((item) => workspace.sendRequest(request, { item }, input.signal)),
          )),
      };
    };

  return {
    diagnostics: ask(DocumentDiagnosticRequest.type),

    /**
     * Whole-program diagnostics for the projects owning a set of files.
     *
     * One request: the server resolves each file to the service owning it, so
     * files sharing a project are checked once. `changed` reports the part of
     * that check covering the files named; `project` reports the rest of what
     * the same check already found, at no additional cost.
     */
    async diagnose(input: {
      readonly files: readonly string[];
      readonly project?: string | undefined;
      readonly scope: "changed" | "project";
      readonly signal: AbortSignal;
    }) {
      // Files come from the watcher and are files; only a named project can be a
      // directory, so only it is resolved. A project is selected by a document it
      // contains — Volar walks up from the document's directory and takes the
      // first configuration that *includes* it, so a directory starts the search
      // one level too high and a `tsconfig.json` is not matched by its own
      // `include`. Both fell back to the workspace root and reported a near-empty
      // check as clean.
      // Without a document the server answers from every project it has loaded,
      // and one server now serves nested roots as well as the root it started at
      // — so a package asking about "the whole project" was answered with a
      // sibling's. The workspace root is the project when it is one; a root that
      // holds no source of its own, a monorepo, has no single project and every
      // loaded one is the honest answer.
      await workspace.flushChanges();
      const named = input.project ?? (input.scope === "project" ? workspace.root : undefined);
      const document = named
        ? await projectDocument(workspace, named).catch(() => undefined)
        : undefined;
      const uris = document
        ? [workspace.getWorkspaceUri(document)]
        : input.files.map((file) => workspace.getWorkspaceUri(file));
      // Asking about changed files when none have changed is a question with an
      // answer already: nothing. Sending it checks every loaded project — twenty-
      // eight seconds on a three-thousand-file one — and reports the whole thing
      // under a heading that says "changed files".
      if (input.scope === "changed" && !uris.length) {
        return {
          configFile: null,
          projectCount: 0,
          fileCount: 0,
          affectedCount: 0,
          diagnostics: [],
          unchanged: true,
        };
      }
      const projects = await workspace.sendRequest(
        ProjectDiagnosticsRequest.type,
        { textDocuments: uris.map((uri) => ({ uri })) },
        input.signal,
      );
      const documents = projects.flatMap(({ documents }) =>
        input.scope === "changed" && uris.length
          ? documents.filter(({ uri }) => uris.includes(uri))
          : documents,
      );
      return {
        unchanged: false,
        configFile: projects.length === 1 ? (projects[0]?.configFile ?? null) : null,
        projectCount: projects.length,
        fileCount: projects.reduce((total, { fileCount }) => total + fileCount, 0),
        affectedCount: documents.length,
        diagnostics: documents
          .flatMap(({ uri, diagnostics }) => diagnostics.map((diagnostic) => ({ uri, diagnostic })))
          .sort(
            (left, right) =>
              (left.diagnostic.severity ?? Number.POSITIVE_INFINITY) -
              (right.diagnostic.severity ?? Number.POSITIVE_INFINITY),
          ),
      };
    },

    documentSymbols: ask(DocumentSymbolRequest.type),

    /**
     * Files that reference a module, assembled from its declarations.
     *
     * The dedicated module-reference request answers nothing under the active
     * TypeScript backend — it returns in single-digit milliseconds without
     * searching. What names a module elsewhere is a use of something the module
     * declares, so each top-level declaration is asked where it is referenced
     * and the answers landing outside the module are what remains. A module
     * imported only for its side effects declares nothing to find this way.
     */
    async fileReferences(input: { readonly file: string; readonly signal: AbortSignal }) {
      const textDocument = await workspace.getTextDocument(input.file);
      const outline = await workspace.sendRequest(
        DocumentSymbolRequest.type,
        { textDocument },
        input.signal,
      );
      const found = await Promise.all(
        (outline ?? []).map(
          (symbol) =>
            workspace.sendRequest(
              WorkspaceReferencesRequest.type,
              {
                textDocument,
                position:
                  "selectionRange" in symbol
                    ? symbol.selectionRange.start
                    : symbol.location.range.start,
                context: { includeDeclaration: false },
              },
              input.signal,
            ) as Promise<Location[] | null>,
        ),
      );
      return {
        textDocument,
        result: found
          .flatMap((locations) => locations ?? [])
          .filter((location) => location.uri !== textDocument.uri),
      };
    },

    async documentLinks(file: string, signal: AbortSignal) {
      const textDocument = await workspace.getTextDocument(file);
      const links = await workspace.sendRequest(DocumentLinkRequest.type, { textDocument }, signal);
      const resolved = await Promise.all(
        (links ?? []).map((link) =>
          link.target ? link : workspace.sendRequest(DocumentLinkResolveRequest.type, link, signal),
        ),
      );
      return {
        textDocument,
        links: resolved.flatMap((link) => {
          if (!link?.target?.startsWith("command:")) return link ? [link] : [];
          const target = commandTargetResource(link.target);
          return target ? [{ ...link, target }] : [];
        }),
      };
    },

    selectionRanges: ask(SelectionRangeRequest.type),

    hover: ask(HoverRequest.type),

    definitions: ask(DefinitionRequest.type),

    typeDefinitions: ask(TypeDefinitionRequest.type),

    implementations: ask(ImplementationRequest.type),

    /**
     * Occurrences of the symbol at a position, within the document holding it.
     *
     * The dedicated highlight request answers nothing under the active
     * TypeScript backend — it returns in single-digit milliseconds without
     * searching — while references answers normally. A highlight is a reference
     * that lands in the same document, so the answer is that search kept to the
     * file it was asked about. Read and write kinds are not reported: the
     * request that distinguishes them is the one that does not answer.
     */
    async documentHighlights(input: {
      readonly file: string;
      readonly signal: AbortSignal;
      readonly params: { readonly position: Position };
    }) {
      const textDocument = await workspace.getTextDocument(input.file);
      const found = (await workspace.sendRequest(
        ReferencesRequest.type,
        {
          textDocument,
          position: input.params.position,
          context: { includeDeclaration: true },
        },
        input.signal,
      )) as Location[] | null;
      return {
        textDocument,
        result: (found ?? [])
          .filter((location) => location.uri === textDocument.uri)
          .map(({ range }) => ({ range })),
      };
    },

    /**
     * Incoming calls, assembled from references and the syntactic outline.
     *
     * The call hierarchy's incoming direction answers nothing under the active
     * TypeScript backend — it returns in single-digit milliseconds without
     * searching — while its prepare step, references, and the outline all
     * answer normally. A reference whose enclosing declaration is not the
     * symbol itself is a declaration that uses the symbol, which is the
     * relationship the incoming direction reports; imports and re-exports sit
     * in no declaration and fall out on their own.
     */
    async callers(input: {
      readonly file: string;
      readonly position: Position;
      readonly signal: AbortSignal;
      readonly scope?: ReferenceScope;
    }) {
      const textDocument = await workspace.getTextDocument(input.file);
      const context = { includeDeclaration: false };
      const [items, references] = await Promise.all([
        workspace.sendRequest(
          CallHierarchyPrepareRequest.type,
          { textDocument, position: input.position },
          input.signal,
        ),
        workspace.sendRequest(
          (input.scope ?? "workspace") === "workspace"
            ? WorkspaceReferencesRequest.type
            : ReferencesRequest.type,
          { textDocument, position: input.position, context },
          input.signal,
        ) as Promise<Location[] | null>,
      ]);
      const calls = await incomingCalls({ workspace, references, subject: items?.[0] });
      return { textDocument, items, calls: items && [calls] };
    },

    callees: callHierarchy(CallHierarchyOutgoingCallsRequest.type),

    async references(input: {
      readonly file: string;
      readonly signal: AbortSignal;
      readonly params: {
        readonly position: Position;
        readonly context: { readonly includeDeclaration: boolean };
        readonly scope: ReferenceScope;
      };
    }) {
      const textDocument = await workspace.getTextDocument(input.file);
      const { position, context, scope } = input.params;
      const result =
        scope === "workspace"
          ? await workspace.sendRequest(
              WorkspaceReferencesRequest.type,
              { textDocument, position, context },
              input.signal,
            )
          : await workspace.sendRequest(
              ReferencesRequest.type,
              { textDocument, position, context },
              input.signal,
            );
      return { textDocument, result: result as Location[] | null };
    },

    async workspaceSymbols(input: {
      readonly file: string;
      readonly query: string;
      readonly signal: AbortSignal;
    }) {
      const textDocument = await workspace.getTextDocument(input.file);
      const project = await workspace.sendRequest(
        GetMatchTsConfigRequest.type,
        textDocument,
        input.signal,
      );
      // Not `workspace/symbol`: it carries no document, so Volar cannot resolve
      // a project from it and searches one holding no files. It answered an
      // empty array for every query, including names declared in a project the
      // same session had already checked.
      const symbols = await workspace.sendRequest(
        WorkspaceDeclarationsRequest.type,
        { textDocument, query: input.query },
        input.signal,
      );
      return {
        textDocument,
        project,
        symbols:
          symbols?.filter(
            (symbol) =>
              sourceCodeUri.test(symbol.location.uri) && !declarationUri.test(symbol.location.uri),
          ) ?? symbols,
      };
    },
  };
};

export type TypeAtlas = ReturnType<typeof createTypeAtlas>;
