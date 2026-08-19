import type { LanguageServer } from "@volar/language-server/node.js";
import type { Location } from "@volar/language-server/protocol.js";
import type { Provide as TypeScriptService } from "volar-service-typescript";
import { URI } from "vscode-uri";

type Services = Parameters<LanguageServer["initialize"]>[2];
type Service = Services[number];
type ServiceContext = Parameters<Service["create"]>[0];

const textDocumentAt = (context: ServiceContext, uri: URI) => {
  const embedded = context.decodeEmbeddedDocumentUri(uri);
  if (embedded) {
    const owner = context.language.scripts.get(embedded[0]);
    const code = owner?.generated?.embeddedCodes.get(embedded[1]);
    return code && context.documents.get(uri, code.languageId, code.snapshot);
  }
  const script = context.language.scripts.get(uri);
  return script && context.documents.get(uri, script.languageId, script.snapshot);
};

export const withReferencesAtPosition = (services: Services): Services =>
  services.map((service) =>
    service.name !== "typescript-semantic"
      ? service
      : {
          ...service,
          create(context) {
            const instance = service.create(context);
            const provide = instance.provide as TypeScriptService | undefined;
            const original = instance.provideReferences?.bind(instance);
            if (!provide || !original) return instance;

            return {
              ...instance,
              provideReferences(document, position, referenceContext, token) {
                const fileName = provide["typescript/documentFileName"](URI.parse(document.uri));
                // findReferences, not getReferencesAtPosition: the tsgo bridge
                // routes only the former to its Go-side implementation
                // (`program.findReferencesTsgo`), and the unrouted JS walk
                // answers undefined or a subset over the bridge's shell files.
                // test/references-probe.test.ts holds both observations.
                const languageService = provide["typescript/languageService"]();
                // The bridge reads `program.isTsgoBackedProgram` before it
                // synchronizes, so a service that has never built a program
                // throws; building it first is the accommodation.
                const entries =
                  fileName && languageService.getProgram()
                    ? languageService
                        .findReferences(fileName, document.offsetAt(position))
                        ?.flatMap((group) => group.references)
                    : undefined;
                if (!entries) {
                  return original(document, position, referenceContext, token);
                }

                return entries.flatMap((entry): Location[] => {
                  const uri = provide["typescript/documentUri"](entry.fileName);
                  const target = textDocumentAt(context, uri);
                  if (!target) return [];
                  return [
                    {
                      uri: uri.toString(),
                      range: {
                        start: target.positionAt(entry.textSpan.start),
                        end: target.positionAt(entry.textSpan.start + entry.textSpan.length),
                      },
                    },
                  ];
                });
              },
            };
          },
        },
  );
