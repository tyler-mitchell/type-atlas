import type { Implementation, ToolAnnotations } from "@modelcontextprotocol/server";
import packageJson from "../package.json" with { type: "json" };

/**
 * Advertised identity for the stdio handshake.
 *
 * MCP allows `https:` and `data:` icon sources and requires clients to reject
 * `file:`. The icon is referenced by URL so the handshake stays small; a
 * `data:` source would carry the encoded asset in every initialize response.
 * Clients that cannot fetch it simply render no icon.
 */
const iconSource =
  "https://raw.githubusercontent.com/tyler-mitchell/type-atlas/main/packages/mcp/assets/type-atlas.png";

export const serverInfo = {
  name: "type-atlas",
  title: "Type Atlas",
  version: packageJson.version,
  description: packageJson.description,
  websiteUrl: packageJson.homepage,
  icons: [
    {
      src: iconSource,
      mimeType: "image/png",
      sizes: ["64x64"],
    },
  ],
} satisfies Implementation;

/**
 * Server-level guidance surfaced to agents by MCP clients.
 *
 * Each item corrects a misreading that costs a wasted call or a wrong
 * conclusion, so keep additions grounded in observed agent behavior.
 */
export const serverInstructions = [
  "Type Atlas answers questions about TypeScript, Markdown, and JSON using the TypeScript project selected for each file.",
  "",
  "Coordinates: every line and character in tool input and output is one-based, matching what editors display.",
  "",
  "Workspace: every tool requires `workspace`, the absolute path to the repository root. It selects the language-server session, so use one stable value for all calls against the same repository rather than a subdirectory.",
  "",
  "Start with `inspect_symbol`. It composes definitions, types, implementations, callers, calls, and remaining references into one call, and its reference list shows only what is not already explained as a call or definition. Prefer it over separate `definitions`, `references`, and `callers` calls; reach for those individually when you need one relationship in full. Select the symbol with either `symbol` (its exact name in the file) or `position`, not both.",
  "",
  "Reference scope: `references`, and the reference section of `inspect_symbol`, answer from every TypeScript project loaded so far, so usages in sibling packages are included once those packages have been loaded. A project nothing has opened yet cannot contribute, and each result names its anchor, so widen an answer by touching a file in the package you expect to hear from. `callers`, `callees`, `implementations`, and `file_references` remain bounded to the project owning `file`.",
  "",
  "Retrieval tools (`search_code`, `investigate_code`, `related_code`, `search_dependency_code`) match meaning, not text. They will not reliably locate an exact string, error message, or comment. Use `workspace_symbols` for an exact declaration name, and your client's own text search for exact text. Their relevance percentages are relative to the top result shown, not absolute confidence, and the first result is always 100%.",
  "",
  "Reading: `read_file` takes an array of paths, so read everything you need in one call rather than calling it repeatedly. Bodies fold to their signatures by default; pass `fold: false` for complete source, and `startLine`/`endLine` to bound every path in the call.",
  "",
  'Diagnostics: file-scoped tools already report ambient errors and warnings for the file they answer about, so `diagnostics` is for what you have changed. It defaults to the files written since this workspace opened; `scope: "project"` reports the whole project from the same check. There is no per-file mode.',
  "",
  "`watch_diagnostics` subscribes to one file for a bounded time: it returns that file's diagnostics now, then republishes them whenever they change, including when the edit that broke it was to a different file. Delivery is your client's half — it is told the file's diagnostics resource changed and reads it back — so this reaches you only if your client acts on resource updates. If it does not, the tool's own reply is all you get and you should re-read diagnostics yourself.",
  "",
  "The first call for a workspace pays language-server startup and may take several seconds; later calls are fast.",
].join("\n");

export const readOnlyToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;
