import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { defineCommand, runMain } from "citty";
import { fileURLToPath } from "node:url";

/**
 * Calls the MCP through its real interface, from current source.
 *
 * A client loads an MCP server once per session, so an attached Type Atlas
 * cannot reflect an edit to `@type-atlas/core` or `@type-atlas/mcp` until that
 * session restarts. Waiting for one turns every change into a claim, and this
 * repository's whole premise is that agent-facing behavior is established by
 * using the tool rather than reasoning about it.
 *
 * This launches the source entrypoint over stdio with the official client,
 * discovers tools normally, calls one, prints the text an agent would receive,
 * and closes the transport before returning. It is the same server the session
 * attaches, started fresh, so it answers from the working tree with no build
 * and no restart.
 *
 * It is not the session-attached MCP, and a result from here must never be
 * described as one. Use it to establish behavior during development; use the
 * attached tools to confirm what a restarted client actually serves.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const withLocalServer = async <Result>(
  task: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const transport = new StdioClientTransport({
    // The `dev` script's command, so local calls cannot drift from it.
    command: process.execPath,
    args: ["--conditions=development", "src/cli.ts"],
    cwd: packageRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "local-mcp-development", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await task(client);
  } finally {
    await client.close();
    await transport.close();
  }
};

const parseArguments = (value: string | undefined) => {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("arguments must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (cause) {
    throw new Error(
      `Could not read arguments as a JSON object: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
};

const call = defineCommand({
  meta: {
    name: "call",
    description: "Call one tool on the source MCP and print the text it returns.",
  },
  args: {
    tool: { type: "positional", description: "Tool name, such as read_file." },
    arguments: {
      type: "positional",
      required: false,
      description: 'Tool arguments as a JSON object, such as \'{"workspace":"/repo"}\'.',
    },
  },
  run: async ({ args }) => {
    if (!args.tool) throw new Error("Name the tool to call.");
    const name = args.tool;
    const { title, result } = await withLocalServer(async (client) => {
      // The published title, so a local row reads like the attached tool's.
      const published = await client.listTools();
      return {
        title: published.tools.find((tool) => tool.name === name)?.title ?? name,
        result: await client.callTool({ name, arguments: parseArguments(args.arguments) }),
      };
    });
    const text = (result.content ?? [])
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n\n");
    process.stdout.write(`Local MCP · ${title}\n\n${text}\n`);
    if (result.isError) process.exitCode = 1;
  },
});

/**
 * Several calls against one server, for behavior that depends on its state.
 *
 * Each `call` starts a server and closes it, so nothing carries between them.
 * Project loading, freshness after an edit, and concurrency are all properties
 * of a server that has already done something, and a fresh one cannot show
 * them: a lookup that widens once a sibling package is loaded looks identical
 * to one that never widens.
 */
const sequence = defineCommand({
  meta: {
    name: "sequence",
    description: "Call several tools against one server, for state-dependent behavior.",
  },
  args: {
    calls: {
      type: "positional",
      description: 'JSON array of { "tool", "arguments" }, called in order.',
    },
  },
  run: async ({ args }) => {
    const parsed: unknown = JSON.parse(args.calls ?? "[]");
    if (!Array.isArray(parsed) || !parsed.length) {
      throw new Error('Pass a non-empty JSON array of { "tool", "arguments" }.');
    }
    const planned = parsed.map((entry) => {
      const { tool, arguments: input } = (entry ?? {}) as {
        tool?: unknown;
        arguments?: unknown;
      };
      if (typeof tool !== "string") throw new Error("Every call needs a tool name.");
      return { tool, input: (input ?? {}) as Record<string, unknown> };
    });
    await withLocalServer(async (client) => {
      const published = await client.listTools();
      for (const { tool, input } of planned) {
        const title = published.tools.find((candidate) => candidate.name === tool)?.title ?? tool;
        // Latency is a correctness concern for a tool an agent calls constantly,
        // and it only shows against a server that has already done work.
        const startedAt = Date.now();
        const result = await client.callTool({ name: tool, arguments: input });
        process.stderr.write(`[${Date.now() - startedAt}ms] ${tool}\n`);
        const text = (result.content ?? [])
          .filter((item): item is { type: "text"; text: string } => item.type === "text")
          .map((item) => item.text)
          .join("\n\n");
        process.stdout.write(`Local MCP · ${title}\n\n${text}\n\n`);
        if (result.isError) process.exitCode = 1;
      }
    });
  },
});

const tools = defineCommand({
  meta: { name: "tools", description: "List the tools the source MCP publishes." },
  args: {
    schema: {
      type: "string",
      required: false,
      description: "Print one tool's published input schema instead of the list.",
    },
  },
  run: async ({ args }) => {
    const published = await withLocalServer((client) => client.listTools());
    if (args.schema) {
      const tool = published.tools.find(({ name }) => name === args.schema);
      if (!tool) throw new Error(`No tool named ${args.schema}.`);
      process.stdout.write(`${JSON.stringify(tool.inputSchema, null, 2)}\n`);
      return;
    }
    process.stdout.write(
      `${published.tools.map(({ name, title }) => `${name} — ${title ?? ""}`).join("\n")}\n`,
    );
  },
});

await runMain(
  defineCommand({
    meta: {
      name: "local-mcp",
      description: "Exercise the Type Atlas MCP from current source, without a client restart.",
    },
    subCommands: { call, sequence, tools },
  }),
);
