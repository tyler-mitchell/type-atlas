import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { serverInfo, serverInstructions } from "./metadata.ts";
import { developmentHost, developmentInstructions } from "./tools.ts";
import { configurePresentation } from "@type-atlas/atlascii";
import { presentationFromEnvironment } from "./presentation.ts";
import { configureIntent } from "./tool.ts";

const capabilities = {
  tools: { listChanged: false },
};

/**
 * Everything the tools need, resolved after stdio is being served.
 *
 * Imported here rather than at module scope because module resolution is the
 * one failure that cannot be recovered from. A missing file anywhere in the
 * tool graph — `atlascii` losing `code-frame.ts` did exactly this — throws
 * before any code runs, so the process died before answering `initialize`. A
 * host does not retry that handshake: it drops the server, and nothing short of
 * restarting the host brings it back, which is how a one-line import mistake
 * has repeatedly ended a session. Resolving it here turns that into a server
 * that answers with no tools and says why, which `reload` repairs once the
 * source is fixed.
 */
const loadRuntime = async () => {
  try {
    const [core, semble, tools] = await Promise.all([
      import("@type-atlas/core"),
      import("./semble.ts"),
      import("./tools.ts"),
    ]);
    return {
      ok: true as const,
      workspaces: core.createVolarWorkspaces(
        new URL(import.meta.resolve("@type-atlas/language-server/node")),
      ),
      semble: semble.createSemble(),
      registerTools: tools.registerTools,
    };
  } catch (cause) {
    return {
      ok: false as const,
      error: cause instanceof Error ? cause : new Error(String(cause)),
    };
  }
};

/** Starts the MCP server over standard input and output. */
export const startMcpServer = async (context?: {
  readonly args?: { readonly "require-intent"?: boolean };
}): Promise<void> => {
  // Before anything renders, and once: how this session writes paths, draws
  // depth, and which glyphs it uses are properties of the client that launched
  // the server, not of any one answer.
  configurePresentation(presentationFromEnvironment());
  configureIntent(context?.args?.["require-intent"] === true);
  const runtime = await loadRuntime();
  if (!runtime.ok) console.error(runtime.error);
  const handle = serveStdio(
    () => {
      const server = new McpServer(serverInfo, {
        instructions: runtime.ok
          ? developmentHost
            ? `${serverInstructions}\n\n${developmentInstructions}`
            : serverInstructions
          : `This server could not load its tools: ${runtime.error.message}\n\nIt is answering so the session survives the failure. Fix the source and call \`reload\`; the tools return with it.`,
        capabilities,
      });
      if (runtime.ok) runtime.registerTools(server, runtime.workspaces, runtime.semble);
      return server;
    },
    { onerror: (error) => console.error(error) },
  );
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void handle
      .close()
      .finally(() =>
        runtime.ok
          ? Promise.allSettled([runtime.workspaces.dispose(), runtime.semble.dispose()])
          : undefined,
      )
      .then(
        () => process.exit(0),
        (error) => {
          console.error(error);
          process.exit(1);
        },
      );
  };
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};
