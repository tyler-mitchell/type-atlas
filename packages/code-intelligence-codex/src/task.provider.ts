import { type } from "arktype";
import type { DynamicToolProvider } from "./provider.ts";

const empty = type({}).onUndeclaredKey("reject");

export const createTaskProvider = (): DynamicToolProvider => ({
  tools: [{
    type: "namespace",
    name: "codex_task",
    description: "Information about the current Codex task.",
    tools: [{
      type: "function",
      name: "changed_files",
      description: "Return files changed by the current Codex task.",
      inputSchema: empty.toJsonSchema(),
    }],
  }],
  call: async (context, request) => {
    const parsed = empty(request.arguments);
    if (parsed instanceof type.errors) throw new Error(parsed.summary);
    return context.changedFiles.length === 0
      ? []
      : [{ type: "inputText", text: context.changedFiles.join("\n") }];
  },
});
