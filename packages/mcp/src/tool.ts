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

/**
 * Registers a tool and bounds its handler with a timeout.
 *
 * `inputSchema` is published by calling the schema's Standard Schema converter
 * and sending the result as the tool's `inputSchema`, which MCP defines as an
 * object schema — `type: "object"` with `properties` and `required`. Anything
 * that converts to another shape, a root-level union above all, publishes no
 * properties and leaves the tool advertising no arguments, so every call fails
 * reporting an argument the caller did supply.
 *
 * Nothing in the chain checks for this: the type parameter only requires a
 * `validate` and a `jsonSchema` converter, and the conversion runs long after
 * the compiler is done. `test/tool-schemas.test.ts` is the check — it reads the
 * packaged server's real `tools/list` response. See "MCP Tool Input Schemas" in
 * AGENTS.md before declaring a schema here.
 */
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
