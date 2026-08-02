import type {
  McpServer,
  StandardSchemaWithJSON,
  Tool,
  ToolCallback,
} from "@modelcontextprotocol/server";

const toolTimeout = 30_000;

type ToolConfig<Input extends StandardSchemaWithJSON, Output extends StandardSchemaWithJSON> = Pick<
  Tool,
  "title" | "description" | "annotations" | "icons" | "_meta"
> & { readonly inputSchema: Input; readonly outputSchema?: Output };

export const registerTool = <
  Input extends StandardSchemaWithJSON,
  Output extends StandardSchemaWithJSON = StandardSchemaWithJSON,
>(
  server: McpServer,
  name: string,
  config: ToolConfig<Input, Output>,
  callback: ToolCallback<Input>,
) => {
  const timedCallback = ((arguments_, context) => {
    const signal = AbortSignal.any([context.mcpReq.signal, AbortSignal.timeout(toolTimeout)]);
    signal.throwIfAborted();
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });

    return Promise.race([
      callback(arguments_, {
        ...context,
        mcpReq: {
          ...context.mcpReq,
          signal,
        },
      }),
      aborted,
    ]);
  }) as ToolCallback<Input>;

  return server.registerTool<Output, Input>(name, config, timedCallback);
};
