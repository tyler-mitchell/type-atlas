import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpRuntime } from "./server.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

export const demoWorkspaceRoot = path.resolve(
  repoRoot,
  "fixtures/demo-workspace",
);

function createClient() {
  return new Client(
    {
      name: "featuretype-local-test-client",
      version: "0.0.0",
    },
    {
      capabilities: {},
    },
  );
}

export type TestClientHandle = {
  client: Client;
  close: () => Promise<void>;
};

export type BasicProbeSummary = {
  toolCount: number;
  toolNames: string[];
  projectRoots: string[];
  diagnosticsText: string;
  diagnosticsStructured: Record<string, unknown> | undefined;
  hoverText: string;
};

export type GitdropsProbeSummary = {
  toolCount: number;
  toolNames: string[];
  projectsText: string;
  workspaceSymbolText: string;
  inspectSymbolText: string;
  implementationsText: string;
  typeDefinitionText: string;
  documentHighlightsText: string;
  fileReferencesText: string;
  callHierarchyText: string;
  prepareRenameText: string;
  renameEditsStructured: Record<string, unknown> | undefined;
  fileRenameEditsStructured: Record<string, unknown> | undefined;
};

type TextContentItem = {
  type: "text";
  text: string;
};

function hasContentItems(
  value: unknown,
): value is { content: Array<{ type?: unknown; text?: unknown }> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    Array.isArray(value.content)
  );
}

export function readTextContent(result: unknown): string {
  if (!hasContentItems(result)) {
    return "";
  }

  return result.content
    .filter(
      (item): item is TextContentItem =>
        item.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n");
}

export function readStructuredContent(result: unknown): Record<string, unknown> | undefined {
  if (typeof result !== "object" || result === null || !("structuredContent" in result)) {
    return undefined;
  }

  const { structuredContent } = result;
  return typeof structuredContent === "object" && structuredContent !== null
    ? (structuredContent as Record<string, unknown>)
    : undefined;
}

export async function createInMemoryTestClient(
  projectRoot?: string,
): Promise<TestClientHandle> {
  const runtime = await createMcpRuntime(projectRoot);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverTransport);

  const client = createClient();
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined);
      await runtime.dispose().catch(() => undefined);
    },
  };
}

export async function createStdioTestClient(
  projectRoot: string,
): Promise<TestClientHandle> {
  const transport = new StdioClientTransport({
    command: "pnpm",
    args: ["--dir", repoRoot, "mcp:stdio:source", projectRoot],
    stderr: "inherit",
  });

  const client = createClient();
  await client.connect(transport);

  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined);
    },
  };
}

export async function runBasicProbe(client: Client): Promise<BasicProbeSummary> {
  const toolList = await client.listTools();
  const projects = await client.callTool({
    name: "list_projects",
    arguments: {},
  });
  const diagnostics = await client.callTool({
    name: "get_diagnostics",
    arguments: {
      file: "broken-button.featuretype",
      summary: true,
      scope: "all",
      severity: "all",
    },
  });
  const hover = await client.callTool({
    name: "get_hover",
    arguments: {
      file: "button.featuretype",
      line: 1,
      col: 3,
    },
  });

  const projectRoots =
    (readStructuredContent(projects)?.projects as Array<{ root?: string }> | undefined)
      ?.map((project) => project.root ?? "")
      .filter((root) => root.length > 0) ?? [];

  return {
    toolCount: toolList.tools.length,
    toolNames: toolList.tools.map((tool) => tool.name),
    projectRoots,
    diagnosticsText: readTextContent(diagnostics),
    diagnosticsStructured: readStructuredContent(diagnostics),
    hoverText: readTextContent(hover),
  };
}

export async function runGitdropsProbe(
  client: Client,
): Promise<GitdropsProbeSummary> {
  const toolList = await client.listTools();
  const projects = await client.callTool({
    name: "list_projects",
    arguments: {},
  });
  const workspaceSymbols = await client.callTool({
    name: "search_workspace_symbols",
    arguments: {
      query: "GeminiPromptApiClient",
      maxResults: 5,
    },
  });
  const inspectSymbol = await client.callTool({
    name: "inspect_symbol",
    arguments: {
      file: "apps/web/src/modules/llm/providers/gemini-prompt-api-client.ts",
      query: "GeminiPromptApiClient",
    },
  });
  const implementations = await client.callTool({
    name: "get_implementations",
    arguments: {
      file: "apps/web/src/modules/llm/types.ts",
      line: 31,
      col: 18,
    },
  });
  const typeDefinition = await client.callTool({
    name: "get_type_definition",
    arguments: {
      file: "apps/web/src/modules/llm/client.ts",
      line: 13,
      col: 36,
    },
  });
  const documentHighlights = await client.callTool({
    name: "get_document_highlights",
    arguments: {
      file: "apps/web/src/modules/llm/providers/gemini-prompt-api-client.ts",
      line: 33,
      col: 14,
    },
  });
  const fileReferences = await client.callTool({
    name: "get_file_references",
    arguments: {
      file: "apps/web/src/modules/llm/providers/gemini-prompt-api-client.ts",
    },
  });
  const callHierarchy = await client.callTool({
    name: "get_call_hierarchy",
    arguments: {
      file: "apps/web/src/modules/llm/providers/gemini-prompt-api-client.ts",
      line: 52,
      col: 9,
    },
  });
  const prepareRenameResult = await client.callTool({
    name: "prepare_rename",
    arguments: {
      file: "apps/web/src/modules/llm/providers/gemini-prompt-api-client.ts",
      line: 33,
      col: 14,
    },
  });
  const renameEdits = await client.callTool({
    name: "get_rename_edits",
    arguments: {
      file: "apps/web/src/modules/llm/providers/gemini-prompt-api-client.ts",
      line: 33,
      col: 14,
      newName: "GeminiPromptApiClientRenamed",
    },
  });
  const fileRenameEdits = await client.callTool({
    name: "get_file_rename_edits",
    arguments: {
      oldFile: "apps/web/src/modules/llm/providers/gemini-prompt-api-client.ts",
      newFile: "apps/web/src/modules/llm/providers/gemini-prompt-api-client-renamed.ts",
    },
  });

  return {
    toolCount: toolList.tools.length,
    toolNames: toolList.tools.map((tool) => tool.name),
    projectsText: readTextContent(projects),
    workspaceSymbolText: readTextContent(workspaceSymbols),
    inspectSymbolText: readTextContent(inspectSymbol),
    implementationsText: readTextContent(implementations),
    typeDefinitionText: readTextContent(typeDefinition),
    documentHighlightsText: readTextContent(documentHighlights),
    fileReferencesText: readTextContent(fileReferences),
    callHierarchyText: readTextContent(callHierarchy),
    prepareRenameText: readTextContent(prepareRenameResult),
    renameEditsStructured: readStructuredContent(renameEdits),
    fileRenameEditsStructured: readStructuredContent(fileRenameEdits),
  };
}
