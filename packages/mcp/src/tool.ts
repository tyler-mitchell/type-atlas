import type {
  McpServer,
  StandardSchemaWithJSON,
  Tool,
  ToolCallback,
} from "@modelcontextprotocol/server";
import { type } from "arktype";
import { renderDocument, requestCost, takeRequestTraces } from "@type-atlas/core";
import { editText } from "./mcp-result.ts";

const toolTimeout = 30_000;

const intentRequired = { current: false };

export const configureIntent = (required: boolean): void => {
  intentRequired.current = required;
};

const broadTools = new Set([
  "find_successor",
  "impact",
  "investigate_code",
  "list_files",
  "occurrences",
  "quorl",
  "related_code",
  "search_code",
  "search_dependency_code",
  "workspace_symbols",
]);

const intentInput = type({
  intent: type("string >= 1").describe(
    "One sentence naming the implementation decision this broad exploration serves.",
  ),
});

const withIntent = <Input extends StandardSchemaWithJSON>(schema: Input): Input =>
  (schema as unknown as { readonly and: (right: unknown) => Input }).and(intentInput);

/**
 * Appends what the call cost to the answer.
 *
 * A cold project load and a warm lookup return the same text, and an agent
 * deciding what to ask next is choosing partly on that difference — whether to
 * narrow a search, whether a package is already loaded, whether a repeat is
 * free. The elapsed time rides along with the answer rather than being
 * something only a maintainer can see.
 */
const withElapsed = async <Result extends object>(
  result: Result,
  started: number,
): Promise<Result> => {
  const rendered = await renderDocument({
    document: "request-cost.mdoc",
    variables: {
      elapsedMs: performance.now() - started,
      cost: requestCost({ traces: takeRequestTraces() }),
    },
  });
  return editText(result, "last", (text) => `${text}\n\n${rendered.text}`);
};

/**
 * Timing out does not stop the language server; the work continues and whatever
 * it loads is there for the next call, which is why repeating is the useful
 * move rather than the wasteful one. The first question asked about a large
 * project pays for building it — thirty seconds is not always enough, and a
 * narrower question would have paid the same. The workspace ends a server that
 * runs past its own, longer deadline, so a second timeout is the signal that
 * the request itself is too large.
 */
const timeoutReason = (tool: string, expiry: AbortSignal, signal: AbortSignal): Error =>
  expiry.aborted
    ? new Error(
        `${tool} did not answer within ${toolTimeout / 1000} seconds. The language server is still working, and the first question asked about a project pays to build it — a smaller question would cost the same. Repeat this call: it joins that work instead of restarting it. If it times out twice, ask for something smaller.`,
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
/*
 * Undeclared keys are NOT rejected, by standing order, after the mechanism
 * intended to catch typos spent a day silently deleting every legitimately
 * new argument instead: the client conforms calls to the schema it cached at
 * connect, and an advertised `additionalProperties: false` told it to strip
 * anything the snapshot did not know. Unknown keys now pass and are ignored;
 * the declared schema still validates everything it declares.
 */

/**
 * Every registered tool, by name, for the development gateway.
 *
 * A client pins tool schemas when it connects, so a tool or parameter added
 * mid-session is stripped or refused client-side before the server ever sees
 * it — which blocks the edit → reload → use loop this repository develops by.
 * The gateway dispatches through this registry instead, validating with the
 * target's live schema, so capability added after connect stays reachable.
 */
type ToolContext = Parameters<ToolCallback<StandardSchemaWithJSON>>[1];
type ErasedToolCallback = (argument: unknown, context: ToolContext) => unknown;

const registered = new Map<
  string,
  { readonly schema: StandardSchemaWithJSON; readonly callback: ErasedToolCallback }
>();

/** Calls a registered tool by name, validated by its current schema. */
export const dispatchTool = async (name: string, argument: unknown, context: ToolContext) => {
  const target = registered.get(name);
  if (!target) {
    throw new Error(
      `No tool "${name}". The tools are ${[...registered.keys()].sort().join(", ")}.`,
    );
  }
  const validated = await target.schema["~standard"].validate(argument ?? {});
  if (validated.issues) {
    throw new Error(
      `${name} arguments: ${validated.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return await target.callback(validated.value, context);
};

export const registerTool = <
  Input extends StandardSchemaWithJSON,
  Output extends StandardSchemaWithJSON = StandardSchemaWithJSON,
>(
  server: McpServer,
  name: string,
  config: ToolConfig<Input, Output>,
  callback: ToolCallback<Input>,
) => {
  const requiresIntent = intentRequired.current && broadTools.has(name);
  const boundedCallback = (async (arguments_, context) => {
    const started = performance.now();
    const stated = (arguments_ as { readonly intent?: unknown }).intent;
    if (requiresIntent && (typeof stated !== "string" || stated.trim() === "")) {
      throw new Error(`${name} requires one sentence of intent for this broad exploration.`);
    }
    // Whatever is in the trace buffer belongs to a call that never reported —
    // one that threw, timed out, or died with the language server. Draining only
    // on the way out left those entries to be attributed to this call: three
    // requests killed by a memory limit reappeared under an unrelated answer as
    // "4 language-server requests · 25.98s" on a call that took 589 ms. The
    // footer is the only instrument this repository measures with, so it may
    // only ever describe the call it is printed under.
    takeRequestTraces();
    const expiry = AbortSignal.timeout(toolTimeout);
    const signal = AbortSignal.any([context.mcpReq.signal, expiry]);
    signal.throwIfAborted();
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(timeoutReason(name, expiry, signal)), {
        once: true,
      });
    });

    try {
      const answered = await Promise.race([
        callback(arguments_, { ...context, mcpReq: { ...context.mcpReq, signal } }),
        aborted,
      ]);
      return withElapsed(answered as object, started);
    } catch (error) {
      // Operational errors go to stderr — the README's stated contract. The
      // client receives only the message; without this, a defect's throw
      // site vanishes with the stack that named it.
      if (error instanceof Error && error.stack) {
        console.error(`[type-atlas] ${name} failed:\n${error.stack}`);
      }
      throw error;
    }
  }) as ToolCallback<Input>;

  // The raw callback, not the bounded one: the gateway wraps its own call in
  // one timeout and one elapsed trailer, and a doubly-wrapped target would
  // print two.
  registered.set(name, {
    schema: config.inputSchema,
    callback: callback as unknown as ErasedToolCallback,
  });
  return server.registerTool<Output, Input>(
    name,
    requiresIntent ? { ...config, inputSchema: withIntent(config.inputSchema) } : config,
    boundedCallback,
  );
};
