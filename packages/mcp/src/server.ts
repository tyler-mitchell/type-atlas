/**
 * FeatureType MCP Server
 *
 * Exposes the canonical FeatureType language server as MCP tools
 * for agent diagnostic and semantic intelligence.
 */

import type { DiagnosticsSession } from "@featuretype/language-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Hover } from "vscode-languageserver-protocol";
import { z } from "zod";
import { classifyFailure } from "./failure";
import { getCodeActions } from "./tools/actions";
import { getDiagnostics } from "./tools/diagnostics";
import { getErrorsAndFixes } from "./tools/errors-and-fixes";
import { getEnrichedFile } from "./tools/enriched-file";
import {
  getCallHierarchy,
  getDefinition,
  getDocumentHighlights,
  getFileReferencesForDocument,
  getImplementations,
  getReferences,
  getTypeDefinition,
} from "./tools/navigation";
import {
  getFileRenameEdits,
  getRenameEdits,
  prepareRename,
} from "./tools/refactors";
import {
  getDocumentSymbolsOutline,
  inspectSymbol,
  searchWorkspaceSymbolsAcrossSessions,
} from "./tools/symbols";
import { getSignature, getTypeAt } from "./tools/type-info";

type AttachedProject = {
  root: string;
  fileCount: number;
  sessionPromise: Promise<DiagnosticsSession>;
};

type CreateDiagnosticsSession = (
  options: { rootDir: string },
) => Promise<DiagnosticsSession>;

export type FeatureTypeMcpRuntime = {
  server: McpServer;
  dispose: () => Promise<void>;
};

const FEATURETYPE_RUNTIME_MODE_ENV = "FEATURETYPE_RUNTIME_MODE";
const mcpModuleDir = path.dirname(
  typeof __filename === "string"
    ? __filename
    : fileURLToPath(import.meta.url),
);
const languageServerSourceModulePath = path.resolve(
  mcpModuleDir,
  "../../language-server/src/index.ts",
);

function getFeatureTypeRuntimeMode(): "auto" | "source" | "dist" {
  const configuredMode = process.env[FEATURETYPE_RUNTIME_MODE_ENV]?.trim().toLowerCase();
  if (configuredMode === "source" || configuredMode === "dist") {
    return configuredMode;
  }
  return "auto";
}

let createDiagnosticsSessionPromise: Promise<CreateDiagnosticsSession> | null = null;

async function loadCreateDiagnosticsSession(): Promise<CreateDiagnosticsSession> {
  if (!createDiagnosticsSessionPromise) {
    createDiagnosticsSessionPromise = (async () => {
      const runtimeMode = getFeatureTypeRuntimeMode();

      if (runtimeMode === "source") {
        if (!fs.existsSync(languageServerSourceModulePath)) {
          throw new Error(
            `FEATURETYPE_RUNTIME_MODE=source requires ${languageServerSourceModulePath} to exist.`,
          );
        }

        const moduleUrl = pathToFileURL(languageServerSourceModulePath).href;
        const languageServerModule = await import(moduleUrl) as {
          createDiagnosticsSession: CreateDiagnosticsSession;
        };
        return languageServerModule.createDiagnosticsSession;
      }

      const languageServerModule = await import("@featuretype/language-server") as {
        createDiagnosticsSession: CreateDiagnosticsSession;
      };
      return languageServerModule.createDiagnosticsSession;
    })();
  }

  return await createDiagnosticsSessionPromise;
}

/**
 * Manages attached project roots and their canonical language-server sessions.
 */
class HostManager {
  private projects = new Map<string, AttachedProject>();
  private activeRoot: string | null;
  private createDiagnosticsSession: CreateDiagnosticsSession;

  constructor(
    initialRoot: string | null,
    createDiagnosticsSession: CreateDiagnosticsSession,
  ) {
    this.activeRoot = initialRoot ? path.resolve(initialRoot) : null;
    this.createDiagnosticsSession = createDiagnosticsSession;
  }

  getActiveRoot(): string | null {
    return this.activeRoot;
  }

  private requireActiveRoot(): string {
    if (!this.activeRoot) {
      throw new Error(
        "No active project is attached. Call attach_project with a repo root first.",
      );
    }
    return this.activeRoot;
  }

  private async ensureProject(rootDir: string): Promise<AttachedProject> {
    const resolvedRoot = path.resolve(rootDir);
    const existing = this.projects.get(resolvedRoot);
    if (existing) {
      return existing;
    }

    const sessionPromise = this.createDiagnosticsSession({ rootDir: resolvedRoot });
    const project: AttachedProject = {
      root: resolvedRoot,
      fileCount: 0,
      sessionPromise,
    };
    this.projects.set(resolvedRoot, project);

    try {
      const session = await sessionPromise;
      project.fileCount = (await session.getProjectFileNames()).length;
      return project;
    } catch (error) {
      this.projects.delete(resolvedRoot);
      throw error;
    }
  }

  resolveRootForFile(filePath: string): string | null {
    if (!path.isAbsolute(filePath) && !this.activeRoot) {
      return null;
    }

    const absPath = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(this.requireActiveRoot(), filePath);
    for (const root of this.projects.keys()) {
      if (absPath.startsWith(root + path.sep) || absPath === root) {
        return root;
      }
    }
    return this.activeRoot;
  }

  async getDiagnosticsSession(rootDir?: string): Promise<DiagnosticsSession> {
    const resolvedRoot = rootDir ?? this.requireActiveRoot();
    return await (await this.ensureProject(resolvedRoot)).sessionPromise;
  }

  getDiagnosticsSessionForFile(filePath: string): Promise<DiagnosticsSession> {
    const resolvedRoot = this.resolveRootForFile(filePath);
    if (!resolvedRoot) {
      throw new Error(
        "No active project is attached. Call attach_project with a repo root first.",
      );
    }
    return this.getDiagnosticsSession(resolvedRoot);
  }

  async getAttachedDiagnosticsSessions(): Promise<DiagnosticsSession[]> {
    if (!this.activeRoot) {
      return [];
    }

    const attachedRoots = [
      this.activeRoot,
      ...[...this.projects.keys()].filter((root) => root !== this.activeRoot),
    ];
    return await Promise.all(
      attachedRoots.map((root) => this.getDiagnosticsSession(root)),
    );
  }

  async attach(projectRoot: string): Promise<{
    root: string;
    fileCount: number;
    isNew: boolean;
  }> {
    const resolved = path.resolve(projectRoot);
    const isNew = !this.projects.has(resolved);
    const project = await this.ensureProject(resolved);
    this.activeRoot = resolved;
    return {
      root: resolved,
      fileCount: project.fileCount,
      isNew,
    };
  }

  async listRoots(): Promise<Array<{ root: string; active: boolean; fileCount: number }>> {
    const projects = await Promise.all(
      [...this.projects.keys()].map((root) => this.ensureProject(root)),
    );
    return projects.map((project) => ({
      root: project.root,
      active: project.root === this.activeRoot,
      fileCount: project.fileCount,
    }));
  }

  async notifyFileChanged(filePath: string): Promise<void> {
    const session = await this.getDiagnosticsSessionForFile(filePath);
    const absPath = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(session.rootDir, filePath);
    await session.notifyFileChanged(absPath);
  }

  async disposeAll(): Promise<void> {
    await Promise.all(
      [...this.projects.values()].map(async ({ sessionPromise }) => {
        try {
          const session = await sessionPromise;
          await session.dispose();
        } catch {
          // Ignore failed or already-disposed diagnostics sessions during teardown.
        }
      }),
    );
  }
}

const projectInfoSchema = {
  root: z.string(),
  active: z.boolean(),
  fileCount: z.number().int().nonnegative(),
};

function formatHoverContents(hover: Hover): string {
  if (typeof hover.contents === "string") {
    return hover.contents;
  }
  if (Array.isArray(hover.contents)) {
    return hover.contents
      .map((content) => (typeof content === "string" ? content : content.value))
      .join("\n\n");
  }
  return hover.contents.value;
}

export function createMcpServer(manager: HostManager): McpServer {
  const server = new McpServer({
    name: "featuretype",
    version: "0.0.0",
  });

  server.registerTool(
    "attach_project",
    {
      description:
        "Attach a new TypeScript project root for semantic analysis. The attached project becomes the active root. Use this when working across multiple repos or when semantic queries fail because a file is outside the current project graph.",
      inputSchema: {
        projectRoot: z
          .string()
          .describe(
            "Absolute or relative path to the project root (directory containing tsconfig.json)",
          ),
      },
      outputSchema: {
        root: z.string(),
        fileCount: z.number().int().nonnegative(),
        isNew: z.boolean(),
        active: z.boolean(),
      },
    },
    async (args) => {
      const result = await manager.attach(args.projectRoot);
      const status = result.isNew
        ? "Attached new project"
        : "Switched to existing project";
      return {
        content: [
          {
            type: "text",
            text: `${status}: ${result.root}\n  ${result.fileCount} files in project graph\n  This is now the active project root.`,
          },
        ],
        structuredContent: {
          root: result.root,
          fileCount: result.fileCount,
          isNew: result.isNew,
          active: true,
        },
      };
    },
  );

  server.registerTool(
    "list_projects",
    {
      description: "List all attached project roots and which is currently active.",
      outputSchema: {
        projects: z.array(z.object(projectInfoSchema)),
      },
    },
    async () => {
      const roots = await manager.listRoots();
      if (roots.length === 0) {
        return {
          content: [{ type: "text", text: "No projects attached." }],
          structuredContent: {
            projects: [],
          },
        };
      }
      const lines = roots.map((root) =>
        `${root.active ? "→ " : "  "}${root.root} (${root.fileCount} files)`,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
          projects: roots,
        },
      };
    },
  );

  server.registerTool(
    "get_diagnostics",
    {
      description:
        "Get TypeScript errors and warnings for a file or the whole project. Use summary mode for project-wide scans to avoid large output.",
      inputSchema: {
        file: z
          .string()
          .optional()
          .describe(
            "File path relative to project root. Omit for all project diagnostics.",
          ),
        severity: z
          .enum(["error", "warning", "all"])
          .optional()
          .describe("Filter by severity (default: all)"),
        summary: z
          .boolean()
          .optional()
          .describe(
            "If true, return grouped counts by file instead of full diagnostic XML. Useful for project-wide scans.",
          ),
      },
      outputSchema: {
        root: z.string(),
        file: z.string().nullable(),
        severity: z.enum(["error", "warning", "all"]),
        summary: z.boolean(),
        totalCount: z.number().int().nonnegative(),
        totalErrorCount: z.number().int().nonnegative(),
        totalWarningCount: z.number().int().nonnegative(),
        files: z
          .array(
            z.object({
              file: z.string(),
              totalCount: z.number().int().nonnegative(),
              totalErrorCount: z.number().int().nonnegative(),
              totalWarningCount: z.number().int().nonnegative(),
              generated: z.boolean(),
            }),
          )
          .optional(),
        limited: z.boolean().optional(),
        projectFileCount: z.number().int().nonnegative().optional(),
        projectFileLimit: z.number().int().nonnegative().optional(),
        error: z
          .object({ code: z.string(), message: z.string() })
          .nullable()
          .optional(),
      },
    },
    async (args) => {
      const session = args.file
        ? await manager.getDiagnosticsSessionForFile(args.file)
        : await manager.getDiagnosticsSession();

      // For file-scoped queries, check membership before calling into the
      // language server. Without this, missing or out-of-scope files silently
      // return empty diagnostics, which is indistinguishable from "no errors".
      if (args.file) {
        const failure = await classifyFailure("get_diagnostics", args.file, session);
        if (failure.code === "NOT_FOUND" || failure.code === "OUT_OF_SCOPE") {
          return {
            content: [{ type: "text", text: failure.message }],
            structuredContent: {
              root: session.rootDir,
              file: args.file,
              severity: (args.severity ?? "all") as "error" | "warning" | "all",
              summary: args.summary ?? false,
              totalCount: 0,
              totalErrorCount: 0,
              totalWarningCount: 0,
              error: { code: failure.code, message: failure.message },
            },
          };
        }
      }

      const diagnosticArgs = {
        file: args.file,
        severity: args.severity as "error" | "warning" | "all" | undefined,
        summary: args.summary,
      };
      const snapshot = await getDiagnostics(session, diagnosticArgs);
      return {
        content: [{ type: "text", text: snapshot.text }],
        structuredContent: {
          root: session.rootDir,
          file: args.file ?? null,
          severity: diagnosticArgs.severity ?? "all",
          summary: diagnosticArgs.summary ?? false,
          totalCount: snapshot.totalCount,
          totalErrorCount: snapshot.totalErrorCount,
          totalWarningCount: snapshot.totalWarningCount,
          files: snapshot.files,
          limited: snapshot.limited ?? false,
          projectFileCount: snapshot.projectFileCount,
          projectFileLimit: snapshot.projectFileLimit,
          error: snapshot.error ?? null,
        },
      };
    },
  );

  server.registerTool(
    "get_type_at",
    {
      description:
        "Get the inferred type and documentation at a position (hover equivalent). Use to understand what the compiler thinks a value is.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getTypeAt(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_signature",
    {
      description:
        "Get function signature help at a call site. Returns parameter names, types, overloads, and documentation.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getSignature(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_definition",
    {
      description:
        "Go to definition. Returns the declaration site, resolved through re-exports, aliases, and generated types.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getDefinition(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_type_definition",
    {
      description:
        "Go to type definition. Useful when value-level definition lands on a constructor or alias but you want the underlying type declaration.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getTypeDefinition(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_implementations",
    {
      description:
        "Find concrete implementations of the symbol at a position. Especially useful for interfaces, abstract contracts, and provider-style indirection.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getImplementations(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_references",
    {
      description:
        "Find all references to a symbol (type-aware, not regex). Returns all usage sites across the project.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getReferences(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_document_highlights",
    {
      description:
        "Find same-file semantic highlights for the symbol at a position. Useful for quick local read-tracing without a full reference search.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getDocumentHighlights(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_file_references",
    {
      description:
        "Find import or module references to a file across the project graph using Volar's built-in file reference request.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum number of references to return. Defaults to 50."),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getFileReferencesForDocument(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_call_hierarchy",
    {
      description:
        "Return incoming and outgoing semantic call relationships for the symbol at a position.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
        maxIncoming: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum incoming calls to show per item. Defaults to 20."),
        maxOutgoing: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum outgoing calls to show per item. Defaults to 20."),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getCallHierarchy(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "prepare_rename",
    {
      description:
        "Check whether a symbol can be renamed at the given position and return the exact rename span when it can.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await prepareRename(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_rename_edits",
    {
      description:
        "Compute workspace edits for renaming the symbol at a position to a new name.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
        newName: z.string().describe("The replacement symbol name."),
      },
      outputSchema: {
        fileCount: z.number().int().nonnegative(),
        textEditCount: z.number().int().nonnegative(),
        renameCount: z.number().int().nonnegative(),
        files: z.array(z.string()),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const summary = await getRenameEdits(session, args);
      return {
        content: [
          {
            type: "text",
            text: summary.text,
          },
        ],
        structuredContent: {
          fileCount: summary.fileCount,
          textEditCount: summary.textEditCount,
          renameCount: summary.renameCount,
          files: summary.files,
        },
      };
    },
  );

  server.registerTool(
    "get_file_rename_edits",
    {
      description:
        "Compute workspace edits for renaming or moving a file so imports and references update consistently.",
      inputSchema: {
        oldFile: z.string().describe("Current file path relative to project root"),
        newFile: z.string().describe("New file path relative to project root"),
      },
      outputSchema: {
        fileCount: z.number().int().nonnegative(),
        textEditCount: z.number().int().nonnegative(),
        renameCount: z.number().int().nonnegative(),
        files: z.array(z.string()),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.oldFile);
      const summary = await getFileRenameEdits(session, args);
      return {
        content: [
          {
            type: "text",
            text: summary.text,
          },
        ],
        structuredContent: {
          fileCount: summary.fileCount,
          textEditCount: summary.textEditCount,
          renameCount: summary.renameCount,
          files: summary.files,
        },
      };
    },
  );

  server.registerTool(
    "get_code_actions",
    {
      description:
        "Get compiler-known quick fixes and refactors for a range. Returns available fixes like add import, narrow type, implement interface.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        startLine: z.number().describe("Start line (1-based)"),
        startCol: z.number().describe("Start column (1-based)"),
        endLine: z.number().describe("End line (1-based)"),
        endCol: z.number().describe("End column (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getCodeActions(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "find_errors_and_fixes",
    {
      description:
        "Get diagnostics paired with their available code actions in a single call. Prefer this over calling get_diagnostics then get_code_actions separately. Defaults to errors only — pass severity: 'all' to include warnings.",
      inputSchema: {
        file: z
          .string()
          .optional()
          .describe(
            "File path relative to project root. Omit to scan the whole project (blocked for large workspaces — attach a smaller root or pass a specific file).",
          ),
        severity: z
          .enum(["error", "warning", "all"])
          .optional()
          .describe("Filter by severity. Defaults to 'error'."),
      },
      outputSchema: {
        totalCount: z.number().int().nonnegative(),
        totalErrorCount: z.number().int().nonnegative(),
        totalWarningCount: z.number().int().nonnegative(),
        limited: z.boolean().optional(),
        projectFileCount: z.number().int().nonnegative().optional(),
        projectFileLimit: z.number().int().nonnegative().optional(),
        items: z.array(
          z.object({
            file: z.string(),
            line: z.number().int().positive(),
            col: z.number().int().positive(),
            severity: z.enum(["error", "warning", "info", "hint"]),
            code: z.string(),
            message: z.string(),
            fixes: z.array(
              z.object({
                title: z.string(),
                kind: z.string(),
                edits: z.array(
                  z.object({
                    file: z.string(),
                    line: z.number().int().positive(),
                    newText: z.string(),
                  }),
                ),
              }),
            ),
          }),
        ),
      },
    },
    async (args) => {
      const session = args.file
        ? await manager.getDiagnosticsSessionForFile(args.file)
        : await manager.getDiagnosticsSession();
      const snapshot = await getErrorsAndFixes(session, args);
      return {
        content: [{ type: "text", text: snapshot.text }],
        structuredContent: {
          totalCount: snapshot.totalCount,
          totalErrorCount: snapshot.totalErrorCount,
          totalWarningCount: snapshot.totalWarningCount,
          limited: snapshot.limited ?? false,
          projectFileCount: snapshot.projectFileCount,
          projectFileLimit: snapshot.projectFileLimit,
          items: snapshot.items,
        },
      };
    },
  );

  server.registerTool(
    "get_enriched_file",
    {
      description:
        "Get file source with diagnostics and type information woven inline as annotations. Expensive but gives a complete picture. Use sparingly.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getEnrichedFile(session, args);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_hover",
    {
      description:
        "Get hover information at a position. For .featuretype files, returns schema descriptions for block tags. For TS/TSX, returns inferred types and JSDoc. Similar to get_type_at but includes all hover content.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const absPath = path.resolve(session.rootDir, args.file);
      const hover = await session.getFileHover(absPath, {
        line: args.line - 1,
        character: args.col - 1,
      });
      if (!hover) {
        const failure = await classifyFailure("get_hover", args.file, session, {
          position: `${args.line}:${args.col}`,
        });
        return {
          content: [{ type: "text" as const, text: failure.message }],
          structuredContent: { error: { code: failure.code, message: failure.message } },
        };
      }

      const text = formatHoverContents(hover);
      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_document_symbols",
    {
      description:
        "Get a compact symbol outline for a file. Defaults to top-level, jump-worthy symbols instead of a full recursive dump. Use query/maxDepth when you want something more targeted.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        query: z
          .string()
          .optional()
          .describe("Optional case-insensitive symbol name/detail filter"),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Maximum nesting depth to include. Defaults to 1 (top-level only)."),
        maxItems: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of symbols to return. Defaults to 25."),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await getDocumentSymbolsOutline(session, args);
      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_workspace_symbols",
    {
      description:
        "Search symbols across the attached project graph using Volar's built-in workspace/symbol support when you know a name but not the file. Especially useful in monorepos when import-site definition lands on a local alias or barrel instead of the owning implementation.",
      inputSchema: {
        query: z
          .string()
          .describe("Case-insensitive symbol name/detail query to search for."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of workspace symbols to return. Defaults to 25."),
      },
      outputSchema: {
        root: z.string().nullable(),
        roots: z.array(z.string()),
        query: z.string(),
        totalSymbols: z.number().int().nonnegative(),
        omittedGeneratedCount: z.number().int().nonnegative(),
        symbols: z.array(
          z.object({
            name: z.string(),
            kind: z.number().int().positive(),
            location: z.union([
              z.object({
                uri: z.string(),
                range: z.object({
                  start: z.object({
                    line: z.number().int().nonnegative(),
                    character: z.number().int().nonnegative(),
                  }),
                  end: z.object({
                    line: z.number().int().nonnegative(),
                    character: z.number().int().nonnegative(),
                  }),
                }),
              }),
              z.object({
                uri: z.string(),
              }),
            ]),
            tags: z.array(z.number().int().nonnegative()).optional(),
            data: z.unknown().optional(),
            containerName: z.string().optional(),
          }),
        ),
      },
    },
    async (args) => {
      const sessions = await manager.getAttachedDiagnosticsSessions();
      const result = await searchWorkspaceSymbolsAcrossSessions(sessions, args);
      return {
        content: [
          {
            type: "text" as const,
            text: result.text,
          },
        ],
        structuredContent: {
          root: manager.getActiveRoot(),
          roots: result.roots,
          query: args.query,
          totalSymbols: result.totalSymbols,
          omittedGeneratedCount: result.omittedGeneratedCount,
          symbols: result.symbols,
        },
      };
    },
  );

  server.registerTool(
    "inspect_symbol",
    {
      description:
        "Inspect a symbol by position or by query. This is a practical implementation tool that combines hover/type info, definition, type definition, implementations, and references into one targeted response.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
        line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Line number (1-based). Use with col."),
        col: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Column number (1-based). Use with line."),
        query: z
          .string()
          .optional()
          .describe("Symbol name/detail query. Use when you do not have an exact position."),
        maxReferences: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Maximum number of reference lines to include. Defaults to 8."),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const text = await inspectSymbol(session, args);
      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "notify_file_changed",
    {
      description:
        "Notify the server that a file has changed on disk. Call this after writing or modifying files so diagnostics stay current.",
      inputSchema: {
        file: z.string().describe("File path relative to project root"),
      },
      outputSchema: {
        file: z.string(),
        acknowledged: z.boolean(),
      },
    },
    async (args) => {
      await manager.notifyFileChanged(args.file);
      return {
        content: [{ type: "text", text: `Acknowledged: ${args.file} updated` }],
        structuredContent: {
          file: args.file,
          acknowledged: true,
        },
      };
    },
  );

  server.registerTool(
    "open_virtual_file",
    {
      description:
        "Register an in-memory file with the language server using caller-supplied content. The file does not need to exist on disk. Relative imports in virtual TypeScript/JavaScript files are normalized to include .js extensions for NodeNext compatibility. All semantic tools (get_diagnostics, get_type_at, get_definition, etc.) work against virtual files exactly as they do against disk files. Calling again with the same path updates the content. Use this to analyze code that is being generated, proposed, or not yet written to disk.",
      inputSchema: {
        file: z
          .string()
          .describe(
            "File path relative to the active project root. Must use a supported extension (.ts, .tsx, .js, etc.).",
          ),
        content: z.string().describe("Full text content of the file."),
      },
      outputSchema: {
        file: z.string(),
        root: z.string(),
        isUpdate: z.boolean(),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSession();
      const wasVirtual = session.isVirtualFile(args.file);
      await session.openVirtualFile(args.file, args.content);
      const action = wasVirtual ? "Updated virtual file" : "Opened virtual file";
      return {
        content: [
          {
            type: "text",
            text: `${action}: ${args.file}\nContent is now registered in the language server. Use get_diagnostics or other semantic tools against this path.`,
          },
        ],
        structuredContent: {
          file: args.file,
          root: session.rootDir,
          isUpdate: wasVirtual,
        },
      };
    },
  );

  server.registerTool(
    "close_virtual_file",
    {
      description:
        "Remove a previously registered virtual file from the language server. After closing, the file will no longer appear in the project graph. No-ops if the path was never opened as virtual.",
      inputSchema: {
        file: z
          .string()
          .describe("File path relative to the active project root."),
      },
      outputSchema: {
        file: z.string(),
        wasRegistered: z.boolean(),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSession();
      const wasRegistered = session.isVirtualFile(args.file);
      await session.closeVirtualFile(args.file);
      return {
        content: [
          {
            type: "text",
            text: wasRegistered
              ? `Closed virtual file: ${args.file}`
              : `No-op: ${args.file} was not registered as a virtual file.`,
          },
        ],
        structuredContent: {
          file: args.file,
          wasRegistered,
        },
      };
    },
  );

  return server;
}

export async function createMcpRuntime(
  projectRoot?: string,
): Promise<FeatureTypeMcpRuntime> {
  const createDiagnosticsSession = await loadCreateDiagnosticsSession();
  const manager = new HostManager(projectRoot ?? null, createDiagnosticsSession);
  if (projectRoot) {
    await manager.attach(projectRoot);
  }

  const server = createMcpServer(manager);

  return {
    server,
    dispose: async () => {
      await server.close();
      await manager.disposeAll();
    },
  };
}

export async function startServer(projectRoot?: string): Promise<void> {
  const runtime = await createMcpRuntime(projectRoot);
  const transport = new StdioServerTransport();
  await runtime.server.connect(transport);

  const shutdown = () => {
    void runtime.dispose().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
