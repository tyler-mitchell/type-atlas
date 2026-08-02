import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { type } from "arktype";
import packageJson from "../package.json" with { type: "json" };

const SearchPage = type({
  query: "string",
  results: type({
    file_path: "string",
    start_line: "number.integer >= 1",
    end_line: "number.integer >= 1",
    score: "number",
    "content?": "string",
  }).array(),
}).onUndeclaredKey("reject");

const SearchResponse = SearchPage.or(
  type({
    error: "string",
  }).onUndeclaredKey("reject"),
);

export type SembleSearchPage = typeof SearchPage.infer;

const parseSearchPage = (text: string): SembleSearchPage => {
  try {
    const response = SearchResponse.assert(JSON.parse(text) as unknown);
    if ("error" in response) throw new Error(response.error);
    return response;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof type.errors) {
      throw new Error(text, { cause: error });
    }
    throw error;
  }
};

export type Semble = {
  search(input: {
    readonly repo: string;
    readonly query: string;
    readonly limit: number;
    readonly snippetLines: number | null;
    readonly signal: AbortSignal;
  }): Promise<SembleSearchPage>;
  findRelated(input: {
    readonly repo: string;
    readonly file: string;
    readonly line: number;
    readonly limit: number;
    readonly snippetLines: number | null;
    readonly signal: AbortSignal;
  }): Promise<SembleSearchPage>;
  dispose(): Promise<void>;
};

export const createSemble = (): Semble => {
  const client = new Client({
    name: "type-atlas",
    version: packageJson.version,
  });
  const transport = new StdioClientTransport({
    command: "uvx",
    args: ["--from", "semble[mcp]==0.5.2", "semble"],
    env: {
      ...getDefaultEnvironment(),
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            entry[0].startsWith("SEMBLE_") && entry[1] !== undefined,
        ),
      ),
    },
    stderr: "ignore",
  });
  const state: { connection?: Promise<void> } = {};

  const request = async (
    input:
      | {
          readonly name: "search";
          readonly arguments: {
            readonly repo: string;
            readonly query: string;
            readonly top_k: number;
            readonly max_snippet_lines: number | null;
          };
          readonly signal: AbortSignal;
        }
      | {
          readonly name: "find_related";
          readonly arguments: {
            readonly repo: string;
            readonly file_path: string;
            readonly line: number;
            readonly top_k: number;
            readonly max_snippet_lines: number | null;
          };
          readonly signal: AbortSignal;
        },
  ): Promise<SembleSearchPage> => {
    await (state.connection ??= client.connect(transport).catch((error: unknown) => {
      state.connection = undefined;
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new Error(
          "Semantic search requires uvx. Install uv from https://docs.astral.sh/uv/getting-started/installation/.",
          { cause: error },
        );
      }
      throw error;
    }));
    const result = await client.callTool(
      { name: input.name, arguments: input.arguments },
      { signal: input.signal },
    );
    const content = result.content.find((item) => item.type === "text");
    if (result.isError) {
      throw new Error(content && "text" in content ? content.text : `Semble ${input.name} failed.`);
    }
    if (!content || !("text" in content)) {
      throw new Error(`Semble ${input.name} returned no text result.`);
    }

    return parseSearchPage(content.text);
  };

  return {
    search: async ({ repo, query, limit, snippetLines, signal }) =>
      await request({
        name: "search",
        arguments: {
          repo,
          query,
          top_k: limit,
          max_snippet_lines: snippetLines,
        },
        signal,
      }),
    findRelated: async ({ repo, file, line, limit, snippetLines, signal }) =>
      await request({
        name: "find_related",
        arguments: {
          repo,
          file_path: file,
          line,
          top_k: limit,
          max_snippet_lines: snippetLines,
        },
        signal,
      }),
    dispose: async () => {
      if (state.connection) await client.close();
    },
  };
};
