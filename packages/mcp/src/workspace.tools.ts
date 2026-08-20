import type { McpServer } from "@modelcontextprotocol/server";
import { renderDocument } from "@type-atlas/core";
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
  "expand?": type({
    "[string]": type("1 <= number.integer <= 10").or(
      type({
        "depth?": type("1 <= number.integer <= 10").describe("Levels below this subtree."),
        "glob?": type("(string >= 1)[]")
          .atLeastLength(1)
          .describe("Picomatch patterns relative to this subtree."),
        "includeHidden?": "boolean",
        "includeIgnored?": "boolean",
      }),
    ),
  }).configure(
    {
      description:
        'Subtrees to open deeper than the shared depth, in place, within the one tree — like expanding folders in a file explorer. Keys are paths relative to `directory`; values are a depth or an options object: `{ "packages/core": 3 }` or `{ "packages/core": { "depth": 3, "glob": ["**/*.ts"] } }` lists the root at `depth` with that corner opened three levels.',
    },
    "self",
  ),
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
  "loc?": type("boolean").configure({
    default: true,
    description: "Suffix each file with its line count (`· 244 loc`).",
  }),
  "git?": type("boolean").configure({
    default: true,
    description:
      "Mark git changes in plain words: `· modified +2 -1`/`added +8`/`deleted -12`/`untracked`/`renamed from old.ts`/`conflicted` on files (deleted files appear as ghost rows), `· N changed` on directories holding changes. Silent outside a repository.",
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
        'Show a bounded workspace-relative project structure. `view: "files"` (the default) is the file tree rooted at the directory, directories first; `view: "directories"` is a compact directory list for architecture orientation. Rows carry `git status` inline — `· modified +2 -1`, `· renamed from old.ts`, `· 2 changed` on directories — so one call answers structure, reading cost, and working-tree state together; no separate git call is needed to see what changed. Results honor .gitignore, omit dependency and VCS internals, and treat Git submodules as separate workspaces by default.',
      inputSchema: input,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace: root,
        directory,
        depth,
        glob,
        expand,
        includeHidden,
        includeIgnored,
        includeSubmodules,
        limit,
        loc,
        git,
        view,
      },
      { mcpReq: { signal } },
    ) => {
      const listing = await workspaceTree({
        workspace: root,
        directory: directory ?? ".",
        depth: depth ?? (glob ? 10 : 1),
        glob,
        expand,
        includeHidden: includeHidden ?? false,
        includeIgnored: includeIgnored ?? false,
        includeSubmodules: includeSubmodules ?? false,
        limit: limit ?? 500,
        loc: loc ?? true,
        git: git ?? true,
        signal,
        view: view ?? "files",
      });
      const rendered = await renderDocument({
        document: "list-files.tool.mdoc",
        variables: { ...listing },
      });
      return textResult(rendered.text);
    },
  );
};
