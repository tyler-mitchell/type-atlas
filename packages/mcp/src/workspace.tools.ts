import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { textResult } from "./mcp-result.ts";
import { registerTool } from "./tool.ts";
import { fileInput } from "./tool-input.ts";
import { workspaceTree } from "./workspace-tree.ts";

const input = type({
  workspace: fileInput.workspace,
  "directory?": type("string").configure({
    default: ".",
    description: "Workspace-relative directory to list.",
  }),
  "depth?": type("1 <= number.integer <= 10").configure({
    description: "Directory levels to include. Defaults to 10 with glob and 1 otherwise.",
  }),
  "glob?": type("(string >= 1)[]").atLeastLength(1).configure(
    {
      description: "One or more OR-combined Picomatch patterns relative to the selected directory.",
    },
    "self",
  ),
  "includeHidden?": type("boolean").configure({
    default: false,
    description: "Include paths whose names begin with a dot.",
  }),
  "includeIgnored?": type("boolean").configure({
    default: false,
    description: "Include files matched by applicable .gitignore files.",
  }),
  "includeSubmodules?": type("boolean").configure({
    default: false,
    description: "Descend into Git submodules instead of treating them as separate workspaces.",
  }),
  "limit?": type("1 <= number.integer <= 5000").configure({
    default: 500,
    description: "Maximum files or directories returned.",
  }),
  "view?": type.enumerated("directories", "files").configure(
    {
      description:
        "One of: files (edit targets grouped by directory, the default), directories (compact architecture orientation).",
    },
    "self",
  ),
});

export const registerWorkspaceTools = (server: McpServer): void => {
  registerTool(
    server,
    "list_files",
    {
      title: "List files",
      description:
        "Show a bounded workspace-relative project structure. The default file view groups edit targets by directory; use the directory view for compact architecture orientation. Results honor .gitignore, omit dependency and VCS internals, and treat Git submodules as separate workspaces by default.",
      inputSchema: input,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        directory,
        depth,
        glob,
        includeHidden,
        includeIgnored,
        includeSubmodules,
        limit,
        view,
      },
      { mcpReq: { signal } },
    ) => {
      return textResult(
        await workspaceTree({
          workspace: root,
          directory: directory ?? ".",
          depth: depth ?? (glob ? 10 : 1),
          glob,
          includeHidden: includeHidden ?? false,
          includeIgnored: includeIgnored ?? false,
          includeSubmodules: includeSubmodules ?? false,
          limit: limit ?? 500,
          signal,
          view: view ?? "files",
        }),
      );
    },
  );
};
