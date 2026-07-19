import type { McpServer } from "@modelcontextprotocol/server";
import { registerAssistanceTools } from "./assistance.tools.ts";
import { registerDocumentTools } from "./document.tools.ts";
import { registerEditingTools } from "./editing.tools.ts";
import { registerNavigationTools } from "./navigation.tools.ts";
import { registerReadFileTool } from "./read_file.tool.ts";
import type { VolarWorkspacePool } from "@featuretype/code-intelligence";

export const registerTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): void => {
  registerReadFileTool(server, workspaces);
  registerDocumentTools(server, workspaces);
  registerAssistanceTools(server, workspaces);
  registerNavigationTools(server, workspaces);
  registerEditingTools(server, workspaces);
};
