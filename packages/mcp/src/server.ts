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
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Hover } from "vscode-languageserver-protocol";
import { z } from "zod";
import { classifyFailure } from "./failure";
import { getCodeActions } from "./tools/actions";
import {
  COLLAPSED_FILE_KINDS,
  getCollapsedFile,
} from "./tools/collapsed-file";
import { getDiagnostics } from "./tools/diagnostics";
import { getErrorsAndFixes } from "./tools/errors-and-fixes";
import { getEnrichedFile } from "./tools/enriched-file";
import {
  getCallHierarchy,
  getDefinition,
  getDocumentHighlights,
  getFileReferencesForDocument,
  getImplementations,
  getReferenceSummary,
  getReferences,
  getTypeDefinition,
} from "./tools/navigation";
import {
  getFileRenameEdits,
  getRenameEdits,
  prepareRename,
} from "./tools/refactors";
import { listModuleExports } from "./tools/module-exports";
import {
  getDocumentSymbolsOutline,
  inspectSymbol,
  searchWorkspaceSymbolsAcrossSessions,
} from "./tools/symbols";
import { getSignature, getTypeAt } from "./tools/type-info";
import {
  normalizeValidateFilesInput,
  validateFiles,
  VALIDATE_FILES_EMPTY_INPUT_MESSAGE,
} from "./tools/validation.js";
import {
  createSlidingWindowRateLimiter,
  parsePositiveIntEnv,
  type RateLimitOutcome,
} from "./rate-limiter.js";
import { consoleMirror } from "./browser/console-mirror.js";
import { tsErrorMirror } from "./diagnostics/error-mirror.js";

type AttachedProject = {
  root: string;
  fileCount: number;
  sessionPromise: Promise<DiagnosticsSession>;
};

type CreateDiagnosticsSession = (options: {
  rootDir: string;
}) => Promise<DiagnosticsSession>;

type PersistedRootState = {
  activeRoot: string | null;
  roots: string[];
};

export type FeatureTypeMcpRuntime = {
  server: McpServer;
  dispose: () => Promise<void>;
};

const FEATURETYPE_RUNTIME_MODE_ENV = "FEATURETYPE_RUNTIME_MODE";
const FEATURETYPE_STATE_FILE_ENV = "FEATURETYPE_MCP_STATE_FILE";
const DIAGNOSTIC_RATE_LIMIT_MAX_CALLS_ENV =
  "FEATURETYPE_DIAGNOSTIC_TOOL_MAX_CALLS_PER_MINUTE";
const DIAGNOSTIC_RATE_LIMIT_WINDOW_MS_ENV =
  "FEATURETYPE_DIAGNOSTIC_TOOL_WINDOW_MS";
const DEFAULT_DIAGNOSTIC_RATE_LIMIT_MAX_CALLS = 120;
const DEFAULT_DIAGNOSTIC_RATE_LIMIT_WINDOW_MS = 60_000;
type DiagnosticToolName =
  | "get_diagnostics"
  | "find_errors_and_fixes"
  | "validate_files";
const MAX_PERSISTED_ROOTS = 12;
const PROJECT_ATTACHMENT_RECOVERY_HINT =
  "If FeatureType is attached to a different repo or worktree, that is not a blocker: call list_projects, then attach_project with the repo/worktree root you are editing and retry.";
const PROJECT_ROOT_INPUT_DESCRIPTION =
  "Absolute or relative path to the TypeScript project root or worktree root you are editing. This switches the active FeatureType project.";
const PROJECT_FILE_INPUT_DESCRIPTION =
  `File path relative to an attached project root, or an absolute path inside an attached root. ${PROJECT_ATTACHMENT_RECOVERY_HINT}`;
const OPTIONAL_PROJECT_FILE_INPUT_DESCRIPTION =
  `Optional file path relative to an attached project root, or an absolute path inside an attached root. Omit to use the active project. ${PROJECT_ATTACHMENT_RECOVERY_HINT}`;
const toRetryAfterSeconds = (resetAt: number, now: number = Date.now()): number =>
  Math.max(1, Math.ceil(Math.max(0, resetAt - now) / 1000));
const mcpModuleDir = path.dirname(
  typeof __filename === "string"
    ? __filename
    : fileURLToPath(import.meta.url),
);
const languageServerSourceModulePath = path.resolve(
  mcpModuleDir,
  "../../language-server/src/index.ts",
);
const persistedRootStateSchema = z.object({
  activeRoot: z.string().nullable().optional(),
  roots: z.array(z.string()).optional(),
});

const toUniqueResolvedPaths = (roots: readonly string[]): string[] =>
  roots.reduce<string[]>((acc, root) => {
    const trimmedRoot = root.trim();
    if (trimmedRoot.length === 0) {
      return acc;
    }

    const resolvedRoot = path.resolve(trimmedRoot);
    return acc.includes(resolvedRoot) ? acc : [...acc, resolvedRoot];
  }, []);

const normalizePersistedRootState = (
  activeRoot: string | null,
  roots: readonly string[],
): PersistedRootState => {
  const normalizedRoots = toUniqueResolvedPaths([
    ...(activeRoot ? [activeRoot] : []),
    ...roots,
  ])
    .filter((root) => fs.existsSync(root))
    .slice(0, MAX_PERSISTED_ROOTS);

  const resolvedActiveRoot = activeRoot ? path.resolve(activeRoot) : null;

  return {
    activeRoot:
      resolvedActiveRoot && normalizedRoots.includes(resolvedActiveRoot)
        ? resolvedActiveRoot
        : normalizedRoots[0] ?? null,
    roots: normalizedRoots,
  };
};

const resolvePersistedStateFile = (): string =>
  path.resolve(
    process.env[FEATURETYPE_STATE_FILE_ENV]?.trim()
      || path.join(os.homedir(), ".featuretype", "mcp-state.json"),
  );

const readPersistedRootState = (stateFile: string): PersistedRootState => {
  try {
    const rawState = fs.readFileSync(stateFile, "utf8");
    const parsedState = persistedRootStateSchema.safeParse(JSON.parse(rawState));
    if (!parsedState.success) {
      return {
        activeRoot: null,
        roots: [],
      };
    }

    return normalizePersistedRootState(
      parsedState.data.activeRoot ?? null,
      parsedState.data.roots ?? [],
    );
  } catch {
    return {
      activeRoot: null,
      roots: [],
    };
  }
};

const writePersistedRootState = (
  stateFile: string,
  state: PersistedRootState,
): void => {
  const normalizedState = normalizePersistedRootState(
    state.activeRoot,
    state.roots,
  );
  const tempStateFile = `${stateFile}.${process.pid}.tmp`;

  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(`${tempStateFile}`, `${JSON.stringify(normalizedState, null, 2)}\n`);
  fs.renameSync(tempStateFile, stateFile);
};

const getDiagnosticRateLimitMaxCalls = (): number =>
  parsePositiveIntEnv(
    DIAGNOSTIC_RATE_LIMIT_MAX_CALLS_ENV,
    DEFAULT_DIAGNOSTIC_RATE_LIMIT_MAX_CALLS,
  );

const getDiagnosticRateLimitWindowMs = (): number =>
  parsePositiveIntEnv(
    DIAGNOSTIC_RATE_LIMIT_WINDOW_MS_ENV,
    DEFAULT_DIAGNOSTIC_RATE_LIMIT_WINDOW_MS,
  );

const isProjectRelativePath = (
  rootDir: string,
  filePath: string,
): { path: string; isInRoot: boolean } => {
  const relativePath = path.relative(rootDir, filePath);
  const isInRoot =
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath);
  return { path: relativePath, isInRoot };
};

const createValidateFilesErrorResult = (
  code: "INVALID_INPUT" | "RATE_LIMIT_EXCEEDED",
  message: string,
) => ({
  isError: true as const,
  content: [{ type: "text" as const, text: message }],
  structuredContent: {
    fileCount: 0,
    totalCount: 0,
    totalErrorCount: 0,
    totalWarningCount: 0,
    files: [],
    error: {
      code,
      message,
    },
  },
});

function getFeatureTypeRuntimeMode(): "auto" | "source" | "dist" {
  const configuredMode =
    process.env[FEATURETYPE_RUNTIME_MODE_ENV]?.trim().toLowerCase();
  if (configuredMode === "source" || configuredMode === "dist") {
    return configuredMode;
  }
  return "auto";
}

let createDiagnosticsSessionPromise: Promise<CreateDiagnosticsSession> | null =
  null;

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
        const languageServerModule = (await import(moduleUrl)) as {
          createDiagnosticsSession: CreateDiagnosticsSession;
        };
        return languageServerModule.createDiagnosticsSession;
      }

      const languageServerModule =
        (await import("@featuretype/language-server")) as {
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
  private knownRoots: string[];
  private stateFile: string;
  private diagnosticToolLimiter = createSlidingWindowRateLimiter({
    limit: getDiagnosticRateLimitMaxCalls(),
    windowMs: getDiagnosticRateLimitWindowMs(),
  });

  constructor(
    initialRoot: string | null,
    createDiagnosticsSession: CreateDiagnosticsSession,
    stateFile: string,
  ) {
    const resolvedInitialRoot = initialRoot ? path.resolve(initialRoot) : null;
    const persistedState = readPersistedRootState(stateFile);
    const restoredState = normalizePersistedRootState(
      resolvedInitialRoot ?? persistedState.activeRoot,
      resolvedInitialRoot ? [resolvedInitialRoot] : persistedState.roots,
    );

    this.activeRoot = restoredState.activeRoot;
    this.createDiagnosticsSession = createDiagnosticsSession;
    this.knownRoots = restoredState.roots;
    this.stateFile = stateFile;
  }

  getActiveRoot(): string | null {
    return this.activeRoot;
  }

  private requireActiveRoot(): string {
    if (!this.activeRoot) {
      throw new Error(
        [
          "No FeatureType project is attached.",
          "",
          PROJECT_ATTACHMENT_RECOVERY_HINT,
        ].join("\n"),
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

    if (!fs.existsSync(resolvedRoot)) {
      throw new Error(
        `Project root does not exist: ${resolvedRoot}\n\nPass an absolute path, or ensure the MCP server's working directory is the repo root when using relative paths.`,
      );
    }

    const sessionPromise = this.createDiagnosticsSession({
      rootDir: resolvedRoot,
    });
    const project: AttachedProject = {
      root: resolvedRoot,
      fileCount: 0,
      sessionPromise,
    };
    this.projects.set(resolvedRoot, project);

    try {
      const session = await sessionPromise;
      project.fileCount = (await session.getProjectFileNames()).length;
      this.rememberRoots([project.root]);
      return project;
    } catch (error) {
      this.projects.delete(resolvedRoot);
      throw error;
    }
  }

  private async refreshProjectFileCount(
    project: AttachedProject,
  ): Promise<number> {
    const session = await project.sessionPromise;
    project.fileCount = (await session.getProjectFileNames()).length;
    return project.fileCount;
  }

  private rememberRoots(roots: readonly string[]): void {
    const restoredState = normalizePersistedRootState(this.activeRoot, [
      ...roots,
      ...this.knownRoots,
      ...this.projects.keys(),
    ]);

    this.activeRoot = restoredState.activeRoot;
    this.knownRoots = restoredState.roots;
  }

  private persistRoots(): void {
    this.rememberRoots([]);

    try {
      writePersistedRootState(this.stateFile, {
        activeRoot: this.activeRoot,
        roots: this.knownRoots,
      });
    } catch {
      // Ignore persistence errors so semantic queries still work in ephemeral environments.
    }
  }

  private getAttachedRoots(): string[] {
    return normalizePersistedRootState(this.activeRoot, [
      ...this.knownRoots,
      ...this.projects.keys(),
    ]).roots;
  }

  private getDiagnosticToolBucketKey(
    tool: DiagnosticToolName,
    rootDir: string,
  ): string {
    return `${tool}:${path.resolve(rootDir)}`;
  }

  checkDiagnosticToolRateLimit(
    tool: DiagnosticToolName,
    rootDir: string,
  ): RateLimitOutcome {
    return this.diagnosticToolLimiter.limit(
      this.getDiagnosticToolBucketKey(tool, rootDir),
    );
  }

  private resolveProjectRoot(projectRoot: string): string {
    if (path.isAbsolute(projectRoot)) {
      return path.resolve(projectRoot);
    }

    const candidates = toUniqueResolvedPaths([
      ...(this.activeRoot ? [path.resolve(this.activeRoot, projectRoot)] : []),
      ...this.getAttachedRoots().map((root) => path.resolve(root, projectRoot)),
      path.resolve(projectRoot),
    ]);

    return candidates.find((candidate) => fs.existsSync(candidate))
      ?? candidates[0]
      ?? path.resolve(projectRoot);
  }

  private findBestAttachedRoot(absPath: string): string | null {
    const matches = this.getAttachedRoots().filter(
      (root) => absPath === root || absPath.startsWith(`${root}${path.sep}`),
    );
    if (matches.length === 0) {
      return null;
    }

    return matches.sort((left, right) => right.length - left.length)[0] ?? null;
  }

  private formatAttachedRootContext(): string {
    const attachedRoots = this.getAttachedRoots();
    const activeRoot = this.activeRoot ?? null;

    if (attachedRoots.length === 0) {
      return "Attached projects: none";
    }

    return [
      "Attached projects:",
      ...attachedRoots.map((root) =>
        `  ${root === activeRoot ? "* " : "  "}${root}`,
      ),
    ].join("\n");
  }

  private formatProjectResolutionFailure(filePath: string): string {
    const requestedPath = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : filePath;
    const reason = path.isAbsolute(filePath)
      ? "Reason: no attached FeatureType project contains this absolute file path."
      : "Reason: no FeatureType project is attached, so this relative file path has no project root.";

    return [
      "FeatureType could not choose a project for this file.",
      "",
      `Requested file: ${requestedPath}`,
      reason,
      "",
      this.formatAttachedRootContext(),
      "",
      PROJECT_ATTACHMENT_RECOVERY_HINT,
    ].join("\n");
  }

  resolveRootForFile(filePath: string): string | null {
    if (path.isAbsolute(filePath)) {
      const absPath = path.resolve(filePath);
      return this.findBestAttachedRoot(absPath);
    }

    const attachedRoots = this.getAttachedRoots();
    if (attachedRoots.length === 0) {
      return null;
    }

    const existingMatches = attachedRoots
      .map((root) => ({
        root,
        absPath: path.resolve(root, filePath),
      }))
      .filter(({ absPath }) => fs.existsSync(absPath));

    const activeRoot = this.activeRoot ?? attachedRoots[0] ?? null;
    if (!activeRoot) {
      return null;
    }
    const activeMatch = existingMatches.find(({ root }) => root === activeRoot);
    if (activeMatch) {
      return activeMatch.root;
    }

    if (existingMatches.length > 0) {
      return existingMatches.sort((left, right) => right.root.length - left.root.length)[0]
        ?.root
        ?? activeRoot;
    }

    const fallbackAbsPath = path.resolve(activeRoot, filePath);
    return this.findBestAttachedRoot(fallbackAbsPath) ?? activeRoot;
  }

  async getDiagnosticsSession(rootDir?: string): Promise<DiagnosticsSession> {
    const resolvedRoot = rootDir ?? this.requireActiveRoot();
    return await (
      await this.ensureProject(resolvedRoot)
    ).sessionPromise;
  }

  getDiagnosticsSessionForFile(filePath: string): Promise<DiagnosticsSession> {
    const resolvedRoot = this.resolveRootForFile(filePath);
    if (!resolvedRoot) {
      throw new Error(this.formatProjectResolutionFailure(filePath));
    }
    return this.getDiagnosticsSession(resolvedRoot);
  }

  async getAttachedDiagnosticsSessions(): Promise<DiagnosticsSession[]> {
    const attachedRoots = this.getAttachedRoots();
    if (attachedRoots.length === 0) {
      return [];
    }

    return await Promise.all(
      attachedRoots.map((root) => this.getDiagnosticsSession(root)),
    );
  }

  async attach(projectRoot: string): Promise<{
    root: string;
    fileCount: number;
    isNew: boolean;
  }> {
    const hadInMemoryProjects = this.projects.size > 0;
    const resolved = this.resolveProjectRoot(projectRoot);
    const isNew = !this.getAttachedRoots().includes(resolved);
    const project = await this.ensureProject(resolved);
    this.activeRoot = resolved;
    if (!hadInMemoryProjects && path.isAbsolute(projectRoot)) {
      this.knownRoots = normalizePersistedRootState(resolved, [resolved]).roots;
    } else {
      this.rememberRoots([resolved]);
    }
    this.persistRoots();
    const fileCount = await this.refreshProjectFileCount(project);
    return {
      root: resolved,
      fileCount,
      isNew,
    };
  }

  async listRoots(): Promise<
    Array<{ root: string; active: boolean; fileCount: number }>
  > {
    const projects = await Promise.all(
      this.getAttachedRoots().map((root) => this.ensureProject(root)),
    );
    await Promise.all(projects.map((project) => this.refreshProjectFileCount(project)));
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
    const project = await this.ensureProject(session.rootDir);
    await this.refreshProjectFileCount(project);
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

const diagnosticFixSchema = z.object({
  title: z.string(),
  kind: z.string(),
  edits: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().positive(),
      newText: z.string(),
    }),
  ),
});

const diagnosticWithFixesSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  col: z.number().int().positive(),
  severity: z.enum(["error", "warning", "info", "hint"]),
  code: z.string(),
  message: z.string(),
  fixes: z.array(diagnosticFixSchema),
});

const referenceSummaryOccurrenceSchema = z.object({
  line: z.number().int().positive(),
  col: z.number().int().positive(),
  text: z.string(),
});

const referenceSummaryFileSchema = z.object({
  file: z.string(),
  count: z.number().int().nonnegative(),
  references: z.array(referenceSummaryOccurrenceSchema),
  omittedCount: z.number().int().nonnegative(),
});

const validatedFileSummarySchema = z.object({
  file: z.string(),
  totalCount: z.number().int().nonnegative(),
  totalErrorCount: z.number().int().nonnegative(),
  totalWarningCount: z.number().int().nonnegative(),
});

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
      title: "Attach Project",
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        "Attach the TypeScript repo or worktree you are editing for semantic analysis. The attached project becomes the active root. Use this whenever list_projects shows a different active root or a semantic query says the file is outside the current project graph.",
      inputSchema: {
        projectRoot: z
          .string()
          .describe(PROJECT_ROOT_INPUT_DESCRIPTION),
      },
      outputSchema: {
        root: z.string(),
        fileCount: z.number().int().nonnegative(),
        isNew: z.boolean(),
        active: z.boolean(),
      },
    },
    async (args) => {
      let result: Awaited<ReturnType<typeof manager.attach>>;
      try {
        result = await manager.attach(args.projectRoot);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
      const status = result.isNew
        ? "Attached new project"
        : "Switched to existing project";
      return {
        content: [
          {
            type: "text",
            text: `${status}: ${result.root}\n  ${result.fileCount} files in project graph\n  This is now the active project root.\n\n${PROJECT_ATTACHMENT_RECOVERY_HINT}`,
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
      title: "List Projects",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "List attached project roots and the active root. Use this first when FeatureType seems pointed at a different repo or worktree than the one you are editing.",
      outputSchema: {
        projects: z.array(z.object(projectInfoSchema)),
      },
    },
    async () => {
      const roots = await manager.listRoots();
      if (roots.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No projects attached.\n\n${PROJECT_ATTACHMENT_RECOVERY_HINT}`,
            },
          ],
          structuredContent: {
            projects: [],
          },
        };
      }
      const activeRoot = roots.find((root) => root.active)?.root ?? "(none)";
      const lines = roots.map(
        (root) =>
          `${root.active ? "* " : "  "}${root.root} (${root.fileCount} files)`,
      );
      return {
        content: [
          {
            type: "text",
            text: [
              `Active project root: ${activeRoot}`,
              "",
              "Attached projects:",
              ...lines,
              "",
              PROJECT_ATTACHMENT_RECOVERY_HINT,
            ].join("\n"),
          },
        ],
        structuredContent: {
          projects: roots,
        },
      };
    },
  );

  server.registerTool(
    "get_diagnostics",
    {
      title: "Get Diagnostics",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Get TypeScript errors and warnings for a file or the whole project. Use summary mode for project-wide scans to avoid large output.",
      inputSchema: {
        file: z
          .string()
          .optional()
          .describe(OPTIONAL_PROJECT_FILE_INPUT_DESCRIPTION),
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
        const failure = await classifyFailure(
          "get_diagnostics",
          args.file,
          session,
        );
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

      const rateLimit = manager.checkDiagnosticToolRateLimit(
        "get_diagnostics",
        session.rootDir,
      );
      if (!rateLimit.success) {
        const message = [
          "Diagnostic request rate limit reached.",
          `Max ${getDiagnosticRateLimitMaxCalls()} calls per`,
          `${getDiagnosticRateLimitWindowMs()}ms for get_diagnostics is in effect.`,
          `Retry after ${toRetryAfterSeconds(rateLimit.reset)} seconds.`,
        ].join(" ");
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: {
            root: session.rootDir,
            file: args.file ?? null,
            severity: (args.severity ?? "all") as "error" | "warning" | "all",
            summary: args.summary ?? false,
            totalCount: 0,
            totalErrorCount: 0,
            totalWarningCount: 0,
            limited: true,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message,
            },
            projectFileCount: undefined,
            projectFileLimit: undefined,
            files: [],
          },
        };
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
    "typecheck_file",
    {
      title: "Typecheck File",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Typecheck one project file and return a simple pass/fail result with diagnostics.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const failure = await classifyFailure(
        "typecheck_file",
        args.file,
        session,
      );
      if (failure.code === "NOT_FOUND" || failure.code === "OUT_OF_SCOPE") {
        return {
          isError: true,
          content: [{ type: "text", text: failure.message }],
        };
      }

      const snapshot = await getDiagnostics(session, {
        file: args.file,
        severity: "all",
      });
      const passed = snapshot.totalErrorCount === 0;
      const header = passed
        ? `Typecheck passed: ${args.file}`
        : `Typecheck failed: ${args.file}`;

      return {
        content: [
          {
            type: "text",
            text: snapshot.totalCount === 0
              ? header
              : `${header}\n\n${snapshot.text}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_type_at",
    {
      title: "Get Type At",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Get the inferred type and documentation at a position (hover equivalent). Use to understand what the compiler thinks a value is.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Get Signature",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Get function signature help at a call site. Returns parameter names, types, overloads, and documentation.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Get Definition",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Go to definition. Returns the declaration site, resolved through re-exports, aliases, and generated types.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Get Type Definition",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Go to type definition. Useful when value-level definition lands on a constructor or alias but you want the underlying type declaration.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Get Implementations",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Find concrete implementations of the symbol at a position. Especially useful for interfaces, abstract contracts, and provider-style indirection.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Get References",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Find all references to a symbol (type-aware, not regex). Returns all usage sites across the project.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
    "get_reference_summary",
    {
      title: "Get Reference Summary",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Summarize references for a symbol by file, with grouped counts and representative usage lines. Prefer this over get_references when you need triage rather than a long flat location list.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
        maxFiles: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of files to include. Defaults to 20."),
        maxReferencesPerFile: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe(
            "Maximum number of representative references to include per file. Defaults to 5.",
          ),
      },
      outputSchema: {
        totalReferences: z.number().int().nonnegative(),
        totalFiles: z.number().int().nonnegative(),
        omittedFiles: z.number().int().nonnegative(),
        files: z.array(referenceSummaryFileSchema),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const summary = await getReferenceSummary(session, args);
      return {
        content: [
          {
            type: "text",
            text: summary.text,
          },
        ],
        structuredContent: {
          totalReferences: summary.totalReferences,
          totalFiles: summary.totalFiles,
          omittedFiles: summary.omittedFiles,
          files: summary.files,
        },
      };
    },
  );

  server.registerTool(
    "get_document_highlights",
    {
      title: "Get Document Highlights",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Find same-file semantic highlights for the symbol at a position. Useful for quick local read-tracing without a full reference search.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Get File References",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Find import or module references to a file across the project graph using Volar's built-in file reference request.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Get Call Hierarchy",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Return incoming and outgoing semantic call relationships for the symbol at a position.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Prepare Rename",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Check whether a symbol can be renamed at the given position and return the exact rename span when it can.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Get Rename Edits",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Compute workspace edits for renaming the symbol at a position to a new name.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Get File Rename Edits",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Compute workspace edits for renaming or moving a file so imports and references update consistently.",
      inputSchema: {
        oldFile: z
          .string()
          .describe(`Current file path. ${PROJECT_FILE_INPUT_DESCRIPTION}`),
        newFile: z
          .string()
          .describe(`New file path. ${PROJECT_FILE_INPUT_DESCRIPTION}`),
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
      title: "Get Code Actions",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Get compiler-known quick fixes and refactors for a range. Returns available fixes like add import, narrow type, implement interface.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Find Errors And Fixes",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Get diagnostics paired with actionable fixes in a single call. Prefer this over calling get_diagnostics then get_code_actions separately. Text output is compact by default, and detailed per-diagnostic fix objects are opt-in.",
      inputSchema: {
        file: z
          .string()
          .optional()
          .describe(
            `Optional file path. ${PROJECT_FILE_INPUT_DESCRIPTION} Omit to scan the whole active project (blocked for large workspaces).`,
          ),
        severity: z
          .enum(["error", "warning", "all"])
          .optional()
          .describe("Filter by severity. Defaults to 'error'."),
        includeItems: z
          .boolean()
          .optional()
          .describe(
            "Include full per-diagnostic fix objects in structuredContent. Defaults to false; pass true to opt in.",
          ),
        includeEmptyFixes: z
          .boolean()
          .optional()
          .describe(
            "Include fixes that do not include a concrete text edit (defaults to false to reduce noise).",
          ),
        includeRefactors: z
          .boolean()
          .optional()
          .describe(
            "Include generic refactors alongside diagnostic fixes. Defaults to false to reduce noisy output.",
          ),
      },
      outputSchema: {
        totalErrorCount: z.number().int().nonnegative(),
        totalWarningCount: z.number().int().nonnegative(),
        totalCount: z.number().int().nonnegative(),
        items: z.array(diagnosticWithFixesSchema).optional(),
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
      const rateLimit = manager.checkDiagnosticToolRateLimit(
        "find_errors_and_fixes",
        session.rootDir,
      );
      if (!rateLimit.success) {
        const message = [
          "Diagnostic request rate limit reached.",
          `Max ${getDiagnosticRateLimitMaxCalls()} calls per`,
          `${getDiagnosticRateLimitWindowMs()}ms for find_errors_and_fixes is in effect.`,
          `Retry after ${toRetryAfterSeconds(rateLimit.reset)} seconds.`,
        ].join(" ");
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: {
            totalCount: 0,
            totalErrorCount: 0,
            totalWarningCount: 0,
            limited: true,
            projectFileCount: undefined,
            projectFileLimit: undefined,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message,
            },
          },
        };
      }
      const snapshot = await getErrorsAndFixes(session, args);
      return {
        content: [{ type: "text", text: snapshot.text }],
        structuredContent: {
          totalErrorCount: snapshot.totalErrorCount,
          totalWarningCount: snapshot.totalWarningCount,
          totalCount: snapshot.totalCount,
          limited: snapshot.limited,
          projectFileCount: snapshot.projectFileCount,
          projectFileLimit: snapshot.projectFileLimit,
          ...((args.includeItems ?? false) ? { items: snapshot.items } : {}),
        },
      };
    },
  );

  server.registerTool(
    "validate_files",
    {
      title: "Validate Files",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Validate several changed files in one call. Refreshes the language server for those files, then returns grouped diagnostic counts and optional fix details for the changed-file set.",
      inputSchema: {
        files: z
          .array(z.string())
          .min(1)
          .max(50)
          .describe(
            `File paths relative to one attached project root, or absolute paths inside one attached root. All files must resolve under the same attached root. ${PROJECT_ATTACHMENT_RECOVERY_HINT}`,
          ),
        severity: z
          .enum(["error", "warning", "all"])
          .optional()
          .describe("Filter by severity. Defaults to 'all'."),
        includeItems: z
          .boolean()
          .optional()
          .describe(
            "Include per-diagnostic fix objects in structuredContent. Defaults to false for a more compact result.",
          ),
      },
      outputSchema: {
        fileCount: z.number().int().nonnegative(),
        totalErrorCount: z.number().int().nonnegative(),
        totalWarningCount: z.number().int().nonnegative(),
        totalCount: z.number().int().nonnegative(),
        files: z.array(validatedFileSummarySchema),
        items: z.array(diagnosticWithFixesSchema).optional(),
        error: z
          .object({ code: z.string(), message: z.string() })
          .nullable()
          .optional(),
      },
    },
    async (args) => {
      const normalizedFiles = normalizeValidateFilesInput(args.files);
      if (normalizedFiles.length === 0) {
        return createValidateFilesErrorResult(
          "INVALID_INPUT",
          VALIDATE_FILES_EMPTY_INPUT_MESSAGE,
        );
      }
      const firstFile = normalizedFiles[0] ?? "";
      const sessionResult = await (async (): Promise<
        | { ok: true; session: DiagnosticsSession }
        | { ok: false; message: string }
      > => {
        try {
          return {
            ok: true,
            session: await manager.getDiagnosticsSessionForFile(firstFile),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, message };
        }
      })();
      if (!sessionResult.ok) {
        return createValidateFilesErrorResult(
          "INVALID_INPUT",
          sessionResult.message,
        );
      }
      const { session } = sessionResult;
      const rateLimit = manager.checkDiagnosticToolRateLimit(
        "validate_files",
        session.rootDir,
      );
      if (!rateLimit.success) {
        const message = [
          "Diagnostic request rate limit reached.",
          `Max ${getDiagnosticRateLimitMaxCalls()} calls per`,
          `${getDiagnosticRateLimitWindowMs()}ms for validate_files is in effect.`,
          `Retry after ${toRetryAfterSeconds(rateLimit.reset)} seconds.`,
        ].join(" ");
        return createValidateFilesErrorResult("RATE_LIMIT_EXCEEDED", message);
      }

      const normalizedPaths: string[] = [];
      const seenNormalizedPaths = new Set<string>();
      for (const file of normalizedFiles) {
        const absPath = path.isAbsolute(file)
          ? path.resolve(file)
          : path.resolve(session.rootDir, file);
        const { path: relativePath, isInRoot } = isProjectRelativePath(
          session.rootDir,
          absPath,
        );

        if (!isInRoot) {
          const message =
            "validate_files requires all files to resolve under the same attached root.";
          return createValidateFilesErrorResult("INVALID_INPUT", message);
        }

        if (seenNormalizedPaths.has(relativePath)) {
          continue;
        }

        seenNormalizedPaths.add(relativePath);
        normalizedPaths.push(relativePath);
      }

      await session.notifyFilesChanged(normalizedPaths);
      const snapshot = await validateFiles(session, {
        files: normalizedPaths,
        severity: args.severity,
        includeItems: args.includeItems,
      });
      return {
        content: [{ type: "text", text: snapshot.text }],
        structuredContent: {
          fileCount: snapshot.fileCount,
          totalErrorCount: snapshot.totalErrorCount,
          totalWarningCount: snapshot.totalWarningCount,
          totalCount: snapshot.totalCount,
          files: snapshot.files,
          error: null,
          ...((args.includeItems ?? false) ? { items: snapshot.items } : {}),
        },
      };
    },
  );

  server.registerTool(
    "get_enriched_file",
    {
      title: "Get Enriched File",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Get file source with diagnostics and type information woven inline as annotations. Expensive but gives a complete picture. Use sparingly.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
    "read_file",
    {
      title: "Read File",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Read a file in near-original form while compacting foldable implementation regions such as functions, JSX trees, and larger comment or region blocks. This is a compact implementation-reading lane built on the language server's folding ranges instead of manual symbol rewriting.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
        kinds: z
          .array(z.enum(COLLAPSED_FILE_KINDS))
          .optional()
          .describe(
            "Optional fold kinds to compact. Defaults to ['code']. Available values: code, imports, comment, region. Imports are kept verbatim to preserve context.",
          ),
        preserveClosingLine: z
          .boolean()
          .optional()
          .describe(
            "Whether to keep the last line of each folded region visible. When omitted, comments keep their closing line while other fold kinds use the default compact rendering.",
          ),
        lineNumbers: z
          .boolean()
          .optional()
          .describe(
            "Whether to prefix the rendered output with original source line numbers. Defaults to false.",
          ),
      },
    },
    async (args) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const snapshot = await getCollapsedFile(session, args);
      return {
        content: [
          {
            type: "text" as const,
            text: snapshot.text,
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_module_exports",
    {
      title: "List Module Exports",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "List the exports of a module using the language server's completion pipeline instead of manual export parsing. This is the preferred entry point for 'what does this package export?' exploration.",
      inputSchema: {
        module: z
          .string()
          .describe("Module specifier to inspect, for example react, zod, or ./local-module.js."),
        fromFile: z
          .string()
          .optional()
          .describe(
            `Optional file path. ${PROJECT_FILE_INPUT_DESCRIPTION} Resolve the module as if imported from this file.`,
          ),
        projectRoot: z
          .string()
          .optional()
          .describe(
            "Optional project root override when multiple projects are attached. Defaults to the active root.",
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of exports to include per page. Defaults to 25."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Optional zero-based offset into the matching export list for progressive paging.",
          ),
        query: z
          .string()
          .optional()
          .describe(
            "Optional case-insensitive export-name query. Prefix matches are preferred; substring matches are used when no prefix matches exist.",
          ),
        surface: z
          .enum(["runtime", "all"])
          .optional()
          .describe(
            "Which export surface to show. Defaults to runtime-only API exports; use all to include type-like exports too.",
          ),
        includeDocs: z
          .boolean()
          .optional()
          .describe(
            "Whether to resolve completion items for documentation/details. Defaults to true.",
          ),
      },
      outputSchema: {
        root: z.string(),
        module: z.string(),
        fromFile: z.string().nullable(),
        query: z.string().nullable(),
        surface: z.enum(["runtime", "all"]),
        probeFile: z.string(),
        totalExports: z.number().int().nonnegative(),
        totalMatchingExports: z.number().int().nonnegative(),
        hiddenExportCount: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        nextOffset: z.number().int().nonnegative().nullable(),
        pageItemCount: z.number().int().nonnegative(),
        isIncomplete: z.boolean(),
      },
    },
    async (args) => {
      const session = args.fromFile
        ? await manager.getDiagnosticsSessionForFile(args.fromFile)
        : await manager.getDiagnosticsSession(args.projectRoot);
      const result = await listModuleExports(session, args);
      return {
        content: [
          {
            type: "text" as const,
            text: result.text,
          },
        ],
        structuredContent: {
          root: session.rootDir,
          module: result.module,
          fromFile: args.fromFile ?? null,
          query: result.query ?? null,
          surface: result.surface,
          probeFile: result.probeFile,
          totalExports: result.totalExports,
          totalMatchingExports: result.totalMatchingExports,
          hiddenExportCount: result.hiddenExportCount,
          offset: result.offset,
          nextOffset: result.nextOffset,
          pageItemCount: result.pageItemCount,
          isIncomplete: result.isIncomplete,
        },
      };
    },
  );

  server.registerTool(
    "get_hover",
    {
      title: "Get Hover",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Get hover information at a position. For .featuretype files, positions inside ts/tsx fences route through Volar embedded TypeScript. For TS/TSX, returns inferred types and JSDoc. Similar to get_type_at but includes all hover content.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
          structuredContent: {
            error: { code: failure.code, message: failure.message },
          },
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
      title: "Get Document Symbols",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Get a compact symbol outline for a file. Defaults to top-level, jump-worthy symbols instead of a full recursive dump. Use query/maxDepth when you want something more targeted.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
          .describe(
            "Maximum nesting depth to include. Defaults to 1 (top-level only).",
          ),
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
      title: "Search Workspace Symbols",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
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
          .describe(
            "Maximum number of workspace symbols to return. Defaults to 25.",
          ),
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
      title: "Inspect Symbol",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      description:
        "Inspect a symbol by position or by query. This is a practical implementation tool that combines hover/type info, definition, type definition, implementations, and references into one targeted response.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
          .describe(
            "Symbol name/detail query. Use when you do not have an exact position.",
          ),
        maxReferences: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe(
            "Maximum number of reference lines to include. Defaults to 8.",
          ),
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
      title: "Notify File Changed",
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        "Notify the server that a file has changed on disk. Call this after writing or modifying files so diagnostics stay current.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
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
      title: "Open Virtual File",
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        "Register an in-memory file with the language server using caller-supplied content. The file does not need to exist on disk. Relative imports in virtual TypeScript/JavaScript files are normalized to include .js extensions for NodeNext compatibility. All semantic tools (get_diagnostics, get_type_at, get_definition, etc.) work against virtual files exactly as they do against disk files. Calling again with the same path updates the content. Use this to analyze code that is being generated, proposed, or not yet written to disk.",
      inputSchema: {
        file: z
          .string()
          .describe(
            `File path relative to the active project root. Must use a supported extension (.ts, .tsx, .js, etc.). ${PROJECT_ATTACHMENT_RECOVERY_HINT}`,
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
      const action = wasVirtual
        ? "Updated virtual file"
        : "Opened virtual file";
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
      title: "Close Virtual File",
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        "Remove a previously registered virtual file from the language server. After closing, the file will no longer appear in the project graph. No-ops if the path was never opened as virtual.",
      inputSchema: {
        file: z
          .string()
          .describe(`File path relative to the active project root. ${PROJECT_ATTACHMENT_RECOVERY_HINT}`),
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

  server.registerTool(
    "browser_console_mirror",
    {
      title: "Browser console mirror",
      description:
        "Toggle an ambient mirror of the live browser console (agent-browser CDP stream — console calls, uncaught exceptions, and Log entries) into a file. Off by default. Agents read the mirrored file; no console-read tool is exposed. action: start | stop | status.",
      inputSchema: {
        action: z.enum(["start", "stop", "status"]),
        out: z
          .string()
          .optional()
          .describe("Output file path (default: .featuretype-browser/console.log)"),
        session: z.string().optional().describe("agent-browser session name"),
      },
    },
    ({ action, out, session }) => {
      const result = consoleMirror(action, { out, session });
      return { content: [{ type: "text" as const, text: result.message }] };
    },
  );

  server.registerTool(
    "ts_error_mirror",
    {
      title: "TypeScript error mirror",
      description:
        "Toggle an ambient mirror of project diagnostics into a file, kept live by the language server's diagnostic-refresh push (no polling). Off by default. action: start | stop | status.",
      inputSchema: {
        action: z.enum(["start", "stop", "status"]),
        out: z
          .string()
          .optional()
          .describe("Output file path (default: .featuretype-diagnostics/errors.txt)"),
        errorsOnly: z.boolean().optional().describe("Mirror errors only (drop warnings)"),
      },
    },
    ({ action, out, errorsOnly }) => {
      const result = tsErrorMirror(action, () => manager.getDiagnosticsSession(), { out, errorsOnly });
      return { content: [{ type: "text" as const, text: result.message }] };
    },
  );

  // --- Temporarily disabled tools (revert: empty this set) ---
  // Kept registered but hidden from tools/list and non-callable.
  const temporarilyDisabledTools = new Set<string>([
    "get_diagnostics",
    "validate_files",
  ]);
  const registeredToolsByName = (
    server as unknown as {
      _registeredTools?: Record<string, { disable?: () => void } | undefined>;
    }
  )._registeredTools;
  for (const toolName of temporarilyDisabledTools) {
    registeredToolsByName?.[toolName]?.disable?.();
  }

  return server;
}

export async function createMcpRuntime(
  projectRoot?: string,
): Promise<FeatureTypeMcpRuntime> {
  const createDiagnosticsSession = await loadCreateDiagnosticsSession();
  const manager = new HostManager(
    projectRoot ?? null,
    createDiagnosticsSession,
    resolvePersistedStateFile(),
  );
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
