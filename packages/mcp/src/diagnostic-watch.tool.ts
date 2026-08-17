import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import type { VolarWorkspacePool } from "@type-atlas/core";
import { type } from "arktype";
import { createDiagnosticWatch } from "./diagnostic-watch.ts";
import { textResult } from "./mcp-result.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { registerTool } from "./tool.ts";
import { fileInput } from "./tool-input.ts";

const watchInput = type({
  ...fileInput,
  "durationSeconds?": type("5 <= number.integer <= 1800").configure({
    default: 300,
    description: "How long to keep watching this file, from 5 to 1800 seconds.",
  }),
});

type WatchTarget = { readonly workspace: string; readonly file: string };

/** Addresses one watched file. The client reads this back when told it changed. */
const resourceUri = ({ workspace, file }: WatchTarget): string =>
  `diagnostics://${Buffer.from(JSON.stringify({ workspace, file })).toString("base64url")}`;

const readResourceUri = (uri: string): WatchTarget | undefined => {
  try {
    return JSON.parse(Buffer.from(uri.replace("diagnostics://", ""), "base64url").toString());
  } catch {
    return undefined;
  }
};

/**
 * Subscribes an agent to one file's diagnostics.
 *
 * An agent otherwise learns that its edit broke something only by asking, and
 * an agent mid-edit rarely thinks to ask. This registers a resource for the
 * file and invalidates it whenever the diagnostics change, so a client holding
 * a subscription is told without the agent spending a call — including when the
 * break lands in a file the agent is not currently looking at.
 *
 * Delivery is the client's half. `sendResourceUpdated` reaches a 2026-07-28
 * `subscriptions/listen` stream and a 2025 client alike, and the client reads
 * the resource back for the report itself, because the protocol's change event
 * carries a URI and no content. A client that ignores resource updates gets
 * only the report this tool returns, and the tool says so rather than implying
 * a delivery that will not happen.
 */
export const registerDiagnosticWatchTool = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
): { readonly dispose: () => void } => {
  const watch = createDiagnosticWatch(workspaces, (target) => {
    void server.server.sendResourceUpdated({ uri: resourceUri(target) }).catch(() => undefined);
  });

  server.registerResource(
    "watched-diagnostics",
    new ResourceTemplate("diagnostics://{target}", { list: undefined }),
    {
      title: "Watched diagnostics",
      description: "The current diagnostics for a file being watched by watch_diagnostics.",
      mimeType: "text/plain",
    },
    (uri) => {
      const target = readResourceUri(uri.href);
      const latest = target && watch.latest(target.workspace, target.file);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: latest ?? "This file is not being watched.",
          },
        ],
      };
    },
  );

  registerTool(
    server,
    "watch_diagnostics",
    {
      title: "Watch diagnostics",
      description:
        "Subscribe to a file's diagnostics for a bounded time. Returns the current diagnostics, then invalidates this file's diagnostics resource whenever they change, so a client that subscribes to resource updates is told without you calling anything — including when an edit to another file is what broke this one. Call it after editing a file you intend to keep working on. Requires a client that acts on resources/updated; the reply names whether this one does.",
      inputSchema: watchInput,
      annotations: readOnlyToolAnnotations,
    },
    async ({ workspace, file, durationSeconds = 300 }, { mcpReq: { signal } }) => {
      const started = await watch.start({ workspace, file, durationSeconds, signal });
      const uri = resourceUri(started);
      // Stated unconditionally, because nothing announces this. A client
      // declares roots, sampling and elicitation; whether it acts on a resource
      // update is a choice it makes later, so a server that claimed to know
      // would be guessing. An agent told the truth here can decide for itself
      // whether to keep checking.
      const result = textResult(
        [
          `=== Watching ${started.file} for ${durationSeconds}s ===`,
          "Changes are published to this file's diagnostics resource. If your client subscribes to resource updates, it is told and reads the report back. If it does not, nothing further reaches you and this reply is the whole answer.",
          "",
          started.diagnostics || "No diagnostics.",
        ].join("\n"),
      );
      return {
        ...result,
        content: [
          ...result.content,
          { type: "resource_link" as const, uri, name: started.file, mimeType: "text/plain" },
        ],
      };
    },
  );

  return { dispose: watch.dispose };
};
