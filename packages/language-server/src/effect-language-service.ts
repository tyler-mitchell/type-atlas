import { dirname } from "node:path";
import type ts from "typescript";

const effectLanguageServiceName = "@effect/language-service";

/** Activates a project-configured Effect TypeScript plugin inside Volar's language service. */
export const withEffectLanguageService = (typescript: typeof ts): typeof ts =>
  new Proxy(typescript, {
    get(target, property, receiver) {
      if (property !== "createLanguageService") return Reflect.get(target, property, receiver);

      const createLanguageService: typeof typescript.createLanguageService = (...args) => {
        const languageService = target.createLanguageService(...args);
        const languageServiceHost = args[0];
        const compilerOptions = languageServiceHost.getCompilationSettings();
        const config = (compilerOptions.plugins as ts.PluginImport[] | undefined)?.find(
          ({ name }) => name === effectLanguageServiceName,
        );
        if (!config) return languageService;

        const configFilePath = compilerOptions.configFilePath;
        const projectDirectory =
          typeof configFilePath === "string"
            ? dirname(configFilePath)
            : languageServiceHost.getCurrentDirectory();
        const serverHost = target.sys as unknown as ts.server.ServerHost;

        try {
          const factory = target.server.Project.resolveModule(
            effectLanguageServiceName,
            projectDirectory,
            serverHost,
            () => undefined,
          ) as ts.server.PluginModuleFactory | undefined;
          if (!factory) {
            console.warn(
              `${effectLanguageServiceName} is configured but not installed for ${projectDirectory}`,
            );
            return languageService;
          }

          const effectLanguageService = factory({ typescript: target }).create({
            config,
            languageService,
            languageServiceHost,
            project: { log: () => undefined } as unknown as ts.server.Project,
            serverHost,
          });
          const programs = new WeakMap<ts.Program, ts.Program>();

          return new Proxy(effectLanguageService, {
            get(service, serviceProperty, serviceReceiver) {
              if (serviceProperty !== "getProgram") {
                return Reflect.get(service, serviceProperty, serviceReceiver);
              }

              return () => {
                const program = service.getProgram();
                if (!program) return undefined;

                const existing = programs.get(program);
                if (existing) return existing;

                const decorated = new Proxy(program, {
                  get(programTarget, programProperty, programReceiver) {
                    if (programProperty !== "getSemanticDiagnostics") {
                      return Reflect.get(programTarget, programProperty, programReceiver);
                    }

                    return (sourceFile?: ts.SourceFile) =>
                      sourceFile
                        ? service.getSemanticDiagnostics(sourceFile.fileName)
                        : programTarget.getSemanticDiagnostics(sourceFile);
                  },
                });
                programs.set(program, decorated);
                return decorated;
              };
            },
          });
        } catch (error) {
          console.warn(`${effectLanguageServiceName} could not be activated`, error);
          return languageService;
        }
      };

      return createLanguageService;
    },
  });
