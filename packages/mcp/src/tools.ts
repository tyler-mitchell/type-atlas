import type { McpServer } from "@modelcontextprotocol/server";
import { registerAssistanceTools } from "./assistance.tools.ts";
import { registerCodeActionTools } from "./code-actions.tools.ts";
import { registerDocumentTools } from "./document.tools.ts";
import { registerEditingTools } from "./editing.tools.ts";
import { registerIntelligenceTools } from "./intelligence.tools.ts";
import { registerNavigationTools } from "./navigation.tools.ts";
import { registerReadFileTool } from "./read_file.tool.ts";
import { registerWorkspaceTools } from "./workspace.tools.ts";
import type { Semble } from "./semble.ts";
import type { VolarWorkspacePool } from "@type-atlas/core";

export const registerTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
  semble: Semble,
): void => {
  registerReadFileTool(server, workspaces);
  registerWorkspaceTools(server);
  registerDocumentTools(server, workspaces);
  registerAssistanceTools(server, workspaces);
  registerNavigationTools(server, workspaces);
  registerEditingTools(server, workspaces);
  registerCodeActionTools(server, workspaces);
  registerIntelligenceTools(server, workspaces, semble);
};
