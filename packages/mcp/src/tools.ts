import type { McpServer } from "@modelcontextprotocol/server";
import { registerAssistanceTools } from "./assistance.tools.ts";
import { registerCodeActionTools } from "./code-actions.tools.ts";
import { registerDiagnosticWatchTool } from "./diagnostic-watch.tool.ts";
import { registerDocumentTools } from "./document.tools.ts";
import { registerEditingTools } from "./editing.tools.ts";
import { registerExperimentalTools } from "./experimental.tools.ts";
import { registerIntelligenceTools } from "./intelligence.tools.ts";
import { registerNavigationTools } from "./navigation.tools.ts";
import { registerReadFileTool } from "./read_file.tool.ts";
import { registerWorkspaceTools } from "./workspace.tools.ts";
import type { Semble } from "./semble.ts";
import type { VolarWorkspacePool } from "@type-atlas/core";
import { type } from "arktype";
import { dispatchTool, registerTool } from "./tool.ts";

/**
 * Whether this server belongs to the development loop's host.
 *
 * Two facts, both required: running from source (`src/cli.ts` under
 * `--conditions=development` — the published package runs `dist`, so no
 * production install can ever qualify), and the development host's own
 * explicit marker in its server environment. The second exists because
 * every local host here runs source — production agents and the loop share
 * the machine — and a development affordance visible in a production
 * catalog plants the idea that the server is theirs to modify.
 */
const developmentHost =
  import.meta.url.includes("/src/") && process.env.TYPE_ATLAS_DEV === "1";

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
  registerExperimentalTools(server, workspaces, semble);
  registerDiagnosticWatchTool(server, workspaces);
  // A client pins tool schemas at connect, so a tool or parameter born after
  // that is stripped or refused before the server sees it — which blocks the
  // edit → reload → use loop this repository develops by. This door is the
  // one schema that never changes: any registered tool, by name, validated
  // by its live schema at dispatch. Source-run only; a production install
  // runs dist and never has it.
  if (developmentHost) {
    registerTool(
      server,
      "call",
      {
        title: "Call",
        description:
          "Development only: call any tool by name, including tools and parameters added after this session connected. arguments is the target tool's own input, validated by its current schema — errors name what the target expected.",
        inputSchema: type({
          tool: type("string >= 1").configure({ description: "The target tool's name." }),
          "arguments?": type("object").configure({
            description: "The target tool's arguments, exactly as it declares them.",
          }),
        }),
        annotations: { readOnlyHint: false },
      },
      async ({ tool, arguments: argument }, context) =>
        dispatchTool(tool, argument, context) as never,
    );
  }
};
