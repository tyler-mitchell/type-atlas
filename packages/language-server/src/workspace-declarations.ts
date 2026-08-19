import type { LanguageServer } from "@volar/language-server/node.js";
import { type Location, SymbolKind } from "@volar/language-server/protocol.js";
import type { Provide as TypeScriptService } from "volar-service-typescript";

type Service = Awaited<ReturnType<LanguageServer["project"]["getLanguageService"]>>;

/** A declaration this server found, always with the place it was found. */
export type Declaration = {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly containerName?: string;
  readonly location: Location;
};

/**
 * Declarations matching a name, from one project's whole program.
 *
 * Volar's own `getWorkspaceSymbols` cannot answer this. `volar-service-typescript`
 * asks TypeScript for the matches and then converts each one through
 * `ctx.getTextDocument(...)`, which resolves only files Volar holds open — so
 * every match in a file nobody opened converts to nothing and is filtered away.
 * A workspace search is almost entirely such files, which is why it answered an
 * empty array for every query while `document_symbols` listed the same names.
 *
 * TypeScript is asked directly instead, and a position is computed from the
 * program's own source file rather than from an open document. The same
 * bypass `references-at-position.ts` makes, for the same reason.
 *
 * Aliases without a container are dropped, matching what the plugin does: a
 * bare re-export is the name arriving somewhere, not being declared there.
 */
export const workspaceDeclarations = (
  service: Service,
  query: string,
): readonly Declaration[] => {
  const languageService = service.context.inject<
    TypeScriptService,
    "typescript/languageService"
  >("typescript/languageService");
  if (!languageService) return [];

  const program = languageService.getProgram();
  return (languageService.getNavigateToItems(query) ?? [])
    .filter((item) => item.containerName || item.kind !== "alias")
    .flatMap((item): Declaration[] => {
      const source = program?.getSourceFile(item.fileName);
      if (!source) return [];
      const uri = service.context.inject<TypeScriptService, "typescript/documentUri">(
        "typescript/documentUri",
        item.fileName,
      );
      if (!uri) return [];
      return [
        {
          name: item.name,
          kind: symbolKinds[item.kind] ?? SymbolKind.Variable,
          ...(item.containerName ? { containerName: item.containerName } : {}),
          location: {
            uri: uri.toString(),
            range: {
              start: source.getLineAndCharacterOfPosition(item.textSpan.start),
              end: source.getLineAndCharacterOfPosition(item.textSpan.start + item.textSpan.length),
            },
          },
        },
      ];
    });
};

/**
 * TypeScript's kind strings as protocol symbol kinds.
 *
 * The protocol's numbers are the shared vocabulary every tool here already
 * speaks; TypeScript's strings are its own. Anything unlisted reads as a
 * variable, which is what an unnamed declaration most often is.
 */
const symbolKinds: Readonly<Record<string, SymbolKind>> = {
  module: SymbolKind.Module,
  class: SymbolKind.Class,
  method: SymbolKind.Method,
  property: SymbolKind.Property,
  constructor: SymbolKind.Constructor,
  enum: SymbolKind.Enum,
  "enum member": SymbolKind.EnumMember,
  interface: SymbolKind.Interface,
  function: SymbolKind.Function,
  var: SymbolKind.Variable,
  let: SymbolKind.Variable,
  const: SymbolKind.Constant,
  "type parameter": SymbolKind.TypeParameter,
  type: SymbolKind.Class,
  alias: SymbolKind.Class,
};
