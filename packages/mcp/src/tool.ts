import type {
  McpServer,
  StandardSchemaWithJSON,
  Tool,
  ToolCallback,
} from "@modelcontextprotocol/server";

const toolTimeout = 30_000;

/**
 * Appends what the call cost to the answer.
 *
 * A cold project load and a warm lookup return the same text, and an agent
 * deciding what to ask next is choosing partly on that difference — whether to
 * narrow a search, whether a package is already loaded, whether a repeat is
 * free. The elapsed time rides along with the answer rather than being
 * something only a maintainer can see.
 */
const withElapsed = <Result extends object>(result: Result, started: number): Result => {
  // A tool may answer with an elicitation instead of content; only an answer
  // that ends in text has somewhere to put this.
  const content = (result as { readonly content?: readonly unknown[] }).content ?? [];
  const last = content.at(-1);
  const text = (last as { readonly type?: string; readonly text?: string } | undefined) ?? {};
  if (text.type !== "text") return result;
  return {
    ...result,
    content: [
      ...content.slice(0, -1),
      { ...text, text: `${text.text}\n\n· ${Math.round(performance.now() - started)}ms` },
    ],
  };
};

/** Timing out does not stop the language server, so repeating the call only queues behind it. */
const timeoutReason = (tool: string, expiry: AbortSignal, signal: AbortSignal): Error =>
  expiry.aborted
    ? new Error(
        `${tool} did not answer within ${toolTimeout / 1000} seconds. The language server is still working on it; ask for something smaller rather than repeating this call.`,
      )
    : signal.reason instanceof Error
      ? signal.reason
      : new Error(`${tool} was cancelled.`);

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
  const boundedCallback = (async (arguments_, context) => {
    const started = performance.now();
    const expiry = AbortSignal.timeout(toolTimeout);
    const signal = AbortSignal.any([context.mcpReq.signal, expiry]);
    signal.throwIfAborted();
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(timeoutReason(name, expiry, signal)), {
        once: true,
      });
    });

    return withElapsed(
      await Promise.race([
        callback(arguments_, { ...context, mcpReq: { ...context.mcpReq, signal } }),
        aborted,
      ]),
      started,
    );
  }) as ToolCallback<Input>;

  return server.registerTool<Output, Input>(name, config, boundedCallback);
};
