import { ProjectDiagnosticsRequest } from "@type-atlas/language-server/protocol";
import {
  CallHierarchyIncomingCallsRequest,
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
  type ReferenceParams,
  SelectionRangeRequest,
  TypeDefinitionRequest,
  WorkspaceSymbolRequest,
} from "@volar/language-server/protocol.js";
import type { Location, RequestType } from "vscode-languageserver-protocol";
import type { VolarWorkspace } from "./volar-workspace.ts";

const sourceCodeUri = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

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
   * each. Both directions differ only in which request answers the second step.
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
   * that check covering the files named; `project` reports the rest of what the
   * same check already found, at no additional cost.
   */
  async diagnose(input: {
    readonly files: readonly string[];
    readonly scope: "changed" | "project";
    readonly signal: AbortSignal;
  }) {
    const uris = input.files.map((file) => workspace.getWorkspaceUri(file));
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

  documentHighlights: ask(DocumentHighlightRequest.type),

  callers: callHierarchy(CallHierarchyIncomingCallsRequest.type),

  callees: callHierarchy(CallHierarchyOutgoingCallsRequest.type),

    // `crossProject` is ours, not LSP's: the server reads it off the same
    // params to decide whether to fan out across loaded projects.
    references: ask<
      ReferenceParams & { readonly crossProject: boolean },
      Location[] | null,
      never
    >(ReferencesRequest.type as never),

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
      const symbols = await workspace.sendRequest(
        WorkspaceSymbolRequest.type,
        { query: input.query },
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
