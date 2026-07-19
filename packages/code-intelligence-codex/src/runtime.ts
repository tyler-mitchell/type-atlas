import type {
  DynamicToolProvider,
  DynamicToolProviderEnvironment,
} from "./provider.ts";
import { namespace } from "./schema.ts";
import { createTaskProvider } from "./task.provider.ts";
import { createDynamicTools } from "./tools.ts";

export const createProviders = ({ languageServer }: DynamicToolProviderEnvironment) => {
  const intelligence = createDynamicTools(languageServer);
  const codeIntelligence: DynamicToolProvider = {
    tools: [namespace],
    call: async (context, request, signal) => {
      const output = await intelligence.call(
        context,
        request.tool,
        request.arguments,
        signal,
      );
      return output ? [{ type: "inputText", text: output }] : [];
    },
    dispose: intelligence.dispose,
  };
  return [createTaskProvider(), codeIntelligence];
};
