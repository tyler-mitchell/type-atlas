/**
 * FeatureType MCP Server
 *
 * Exposes the canonical FeatureType language server as MCP tools
 * for agent diagnostic and semantic intelligence.
 */

import type { DiagnosticsSession } from "@featuretype/language-server";
import { getSupportedElicitationModes } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  RootsListChangedNotificationSchema,
  type ServerNotification,
  type ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ApplyWorkspaceEditResult,
  CodeAction,
  Command,
  Hover,
  WorkspaceEdit,
} from "vscode-languageserver-protocol";
import { z } from "zod";
import { classifyFailure } from "./failure";
import { getCodeActions } from "./tools/actions";
import { getFormattingEdit } from "./tools/formatting.js";
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
import {
  compileWorkspaceOperations,
  executeWorkspaceEdit,
  getWorkspaceEditAnnotations,
  readWorkspaceFile,
  withWorkspaceEditTransaction,
  type LockedWorkspaceEditApplier,
  type WorkspaceEditExecutionOptions,
  type WorkspaceEditResult,
  type WorkspaceEditOperation,
} from "./editing/workspace-edit.js";

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
const CODEX_SANDBOX_STATE_CAPABILITY = "codex/sandbox-state-meta";
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
  private clientRootLoader: (() => Promise<void>) | null = null;
  private clientRootsReady: Promise<void> | null = null;
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

  setClientRootLoader(loader: () => Promise<void>): void {
    this.clientRootLoader = loader;
  }

  refreshClientRoots(): Promise<void> {
    const ready = this.clientRootLoader?.() ?? Promise.resolve();
    this.clientRootsReady = ready.catch(() => undefined);
    return this.clientRootsReady;
  }

  private ensureClientRoots(): Promise<void> {
    return this.clientRootsReady ?? this.refreshClientRoots();
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
    await this.ensureClientRoots();
    const resolvedRoot = rootDir ?? this.requireActiveRoot();
    return await (
      await this.ensureProject(resolvedRoot)
    ).sessionPromise;
  }

  async getDiagnosticsSessionForProject(projectRoot: string): Promise<DiagnosticsSession> {
    await this.ensureClientRoots();
    return await this.getDiagnosticsSession(this.resolveProjectRoot(projectRoot));
  }

  async getDiagnosticsSessionForFile(filePath: string): Promise<DiagnosticsSession> {
    await this.ensureClientRoots();
    const resolvedRoot = this.resolveRootForFile(filePath);
    if (!resolvedRoot) {
      throw new Error(this.formatProjectResolutionFailure(filePath));
    }
    return await this.getDiagnosticsSession(resolvedRoot);
  }

  async getAttachedDiagnosticsSessions(): Promise<DiagnosticsSession[]> {
    await this.ensureClientRoots();
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
    await this.ensureClientRoots();
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

  adoptClientRoots(roots: readonly string[]): void {
    const clientRoots = toUniqueResolvedPaths(roots).filter((root) => fs.existsSync(root));
    if (clientRoots.length === 0) return;
    const activeIsInClientRoot = this.activeRoot !== null && clientRoots.some((root) =>
      this.activeRoot === root || this.activeRoot?.startsWith(`${root}${path.sep}`)
    );
    if (!activeIsInClientRoot) this.activeRoot = clientRoots[0] ?? this.activeRoot;
    this.rememberRoots(clientRoots);
    this.persistRoots();
  }

  async listRoots(): Promise<
    Array<{ root: string; active: boolean; fileCount: number }>
  > {
    await this.ensureClientRoots();
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

  async notifyFilesChanged(
    rootDir: string,
    filePaths: readonly string[],
  ): Promise<void> {
    const session = await this.getDiagnosticsSession(rootDir);
    await session.notifyFilesChanged(
      filePaths.map((filePath) => path.resolve(rootDir, filePath)),
    );
    const project = await this.ensureProject(rootDir);
    await this.refreshProjectFileCount(project);
  }

  async executeCommand(
    rootDir: string,
    command: Command,
    applyEdit: (edit: WorkspaceEdit, label?: string) => Promise<ApplyWorkspaceEditResult>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const session = await this.getDiagnosticsSession(rootDir);
    if (!session.canExecuteCommand(command.command)) {
      throw new Error(`The language server did not advertise command ${command.command}.`);
    }
    return await session.executeCommand(command, applyEdit, signal);
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

const workspaceEditOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("replace"),
    file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
    oldText: z.string().min(1).describe("Exact existing text to replace."),
    newText: z.string().describe("Replacement text."),
    expectedOccurrences: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Required occurrence count. Defaults to 1."),
  }),
  z.object({
    kind: z.literal("write"),
    file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
    content: z.string().describe("Complete desired UTF-8 file content."),
    ifMatch: z
      .string()
      .describe("Revision returned by read_file mode='exact'."),
  }),
  z.object({
    kind: z.literal("create"),
    file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
    content: z.string().describe("Complete UTF-8 content for the new file."),
  }),
  z.object({
    kind: z.literal("move"),
    oldFile: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
    newFile: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
    ifMatch: z
      .string()
      .describe("Source revision returned by read_file mode='exact'."),
    overwrite: z
      .boolean()
      .optional()
      .describe("Whether to replace an existing destination. Defaults to false."),
  }),
  z.object({
    kind: z.literal("delete"),
    file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
    ifMatch: z
      .string()
      .describe("Revision returned by read_file mode='exact'."),
  }),
]);

const formatWorkspaceEditResult = (result: WorkspaceEditResult): string => {
  const heading = `${result.status === "applied" ? "Applied" : "Previewed"} workspace edit across ${result.files.length} file(s).`;
  const annotationLines = result.annotations.length === 0
    ? []
    : [
        "Annotations:",
        ...result.annotations.map((annotation) =>
          `- ${annotation.label}${annotation.description ? ` — ${annotation.description}` : ""}`
        ),
      ];
  const previewLines = result.preview.split("\n");
  const visiblePreview = previewLines.slice(0, 200).join("\n");
  const continuation = previewLines.length > 200
    ? `\n\nPreview truncated after 200 of ${previewLines.length} lines; read the changed files for exact results.`
    : "";
  return [
    heading,
    ...result.files.map((file) => `- ${file}`),
    ...annotationLines,
    ...result.warnings.map((warning) => `Warning: ${warning}`),
    visiblePreview,
  ].filter(Boolean).join("\n") + continuation;
};

const combineWorkspaceEditResults = (
  results: readonly WorkspaceEditResult[],
): WorkspaceEditResult => ({
  status: results.some((result) => result.status === "applied") ? "applied" : "preview",
  files: [...new Set(results.flatMap((result) => result.files))].sort(),
  preview: results.map((result) => result.preview).filter(Boolean).join("\n\n"),
  annotations: results.flatMap((result) => result.annotations),
  warnings: results.flatMap((result) => result.warnings),
});

const EDITOR_COMMANDS = new Set([
  "editor.action.rename",
  "editor.action.showReferences",
  "setSelection",
]);

const reportToolProgress = async (
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  progress: number,
  total: number,
  message: string,
): Promise<void> => {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;
  await extra.sendNotification({
    method: "notifications/progress",
    params: { progressToken, progress, total, message },
  });
};

const reportWorkspaceEditPhase = (
  progress: ((value: number, message: string) => Promise<void>) | undefined,
  phase: Parameters<NonNullable<WorkspaceEditExecutionOptions["onProgress"]>>[0],
): Promise<void> => progress?.(
  phase === "preparing" ? 3 : phase === "committing" ? 4 : 5,
  phase === "preparing"
    ? "Preparing workspace edit"
    : phase === "committing"
    ? "Committing workspace edit"
    : "Refreshing language server",
) ?? Promise.resolve();

export function createMcpServer(manager: HostManager): McpServer {
  const server = new McpServer({
    name: "featuretype",
    version: "0.0.0",
  }, {
    capabilities: {
      experimental: {
        [CODEX_SANDBOX_STATE_CAPABILITY]: {},
      },
    },
  });
  const syncClientRoots = async (): Promise<void> => {
    if (!server.server.getClientCapabilities()?.roots) return;
    const result = await server.server.listRoots();
    manager.adoptClientRoots(result.roots.flatMap((root) => {
      try {
        return root.uri.startsWith("file:") ? [fileURLToPath(root.uri)] : [];
      } catch {
        return [];
      }
    }));
  };
  manager.setClientRootLoader(syncClientRoots);
  server.server.setNotificationHandler(
    RootsListChangedNotificationSchema,
    () => manager.refreshClientRoots(),
  );
  const confirmWorkspaceEdit = async (
    edit: WorkspaceEdit,
    explicitConfirmation?: boolean,
  ): Promise<boolean | undefined> => {
    const confirmations = getWorkspaceEditAnnotations(edit)
      .filter((annotation) => annotation.needsConfirmation);
    if (confirmations.length === 0 || explicitConfirmation === true) {
      return explicitConfirmation;
    }
    if (explicitConfirmation === false) {
      throw new Error("Workspace edit confirmation was declined.");
    }
    if (!getSupportedElicitationModes(
      server.server.getClientCapabilities()?.elicitation,
    ).supportsFormMode) {
      return explicitConfirmation;
    }
    const result = await server.server.elicitInput({
      mode: "form",
      message: [
        "The language server marked these changes as requiring confirmation:",
        ...confirmations.map((annotation) =>
          `- ${annotation.label}${annotation.description ? ` — ${annotation.description}` : ""}`
        ),
      ].join("\n"),
      requestedSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "Apply these changes",
            description: "Confirm the annotated workspace edit.",
          },
        },
        required: ["confirm"],
      },
    });
    if (result.action !== "accept" || result.content?.confirm !== true) {
      throw new Error("Workspace edit confirmation was declined.");
    }
    return true;
  };
  const workspaceEditExecutionHooks = (
    session: DiagnosticsSession,
    requestMeta: unknown,
    signal: AbortSignal | undefined,
    progress?: (value: number, message: string) => Promise<void>,
  ): Pick<
    WorkspaceEditExecutionOptions,
    "requestMeta" | "signal" | "getDocumentVersion" | "onFilesChanged" | "onProgress"
  > => ({
    requestMeta,
    signal,
    getDocumentVersion: (file) => session.getFileVersion(file),
    onFilesChanged: (root, files) => manager.notifyFilesChanged(root, files),
    onProgress: progress ? (phase) => reportWorkspaceEditPhase(progress, phase) : undefined,
  });
  const runWorkspaceEdit = (
    session: DiagnosticsSession,
    edit: WorkspaceEdit,
    options: {
      mode?: "preview" | "apply";
      confirm?: boolean;
      requestMeta?: unknown;
      signal?: AbortSignal;
      expectedRevisions?: ReadonlyMap<string, string>;
      progress?: (progress: number, message: string) => Promise<void>;
    },
  ): Promise<WorkspaceEditResult> => {
    const { progress, ...executionOptions } = options;
    return executeWorkspaceEdit(session.rootDir, edit, {
      ...executionOptions,
      ...workspaceEditExecutionHooks(
        session,
        options.requestMeta,
        options.signal,
        progress,
      ),
    });
  };
  const runGeneratedWorkspaceEdit = async (
    session: DiagnosticsSession,
    options: {
      mode?: "preview" | "apply";
      confirm?: boolean;
      requestMeta?: unknown;
      signal?: AbortSignal;
      expectedRevisions?: ReadonlyMap<string, string>;
      progress?: (progress: number, message: string) => Promise<void>;
    },
    generate: () => Promise<{
      edit: WorkspaceEdit;
      expectedRevisions?: ReadonlyMap<string, string>;
    }>,
  ): Promise<WorkspaceEditResult> => {
    if ((options.mode ?? "apply") === "preview") {
      await options.progress?.(0, "Generating workspace edit");
      const generated = await generate();
      await options.progress?.(1, "Preparing preview");
      const result = await runWorkspaceEdit(session, generated.edit, {
        ...options,
        expectedRevisions: generated.expectedRevisions ?? options.expectedRevisions,
      });
      await options.progress?.(6, "Preview ready");
      return result;
    }
    await options.progress?.(0, "Waiting for workspace mutation lock");
    return withWorkspaceEditTransaction(session.rootDir, options.signal, async (apply) => {
      await options.progress?.(1, "Generating workspace edit");
      const generated = await generate();
      await options.progress?.(2, "Checking workspace edit confirmation");
      const confirm = await confirmWorkspaceEdit(generated.edit, options.confirm);
      const result = await apply(generated.edit, {
        confirm,
        expectedRevisions: generated.expectedRevisions ?? options.expectedRevisions,
        ...workspaceEditExecutionHooks(
          session,
          options.requestMeta,
          options.signal,
          options.progress,
        ),
      });
      await options.progress?.(6, "Workspace edit complete");
      return result;
    });
  };
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
    "edit_workspace",
    {
      title: "Edit Workspace",
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        "Apply an ordered multi-file source change without authoring a diff, URI, or LSP range. Exact replacements validate their own context. Whole-file writes, moves, and deletes require revisions from read_file mode='exact'. Preview is stateless; apply is the default.",
      inputSchema: {
        operations: z
          .array(workspaceEditOperationSchema)
          .min(1)
          .describe("Ordered create, replace, write, move, and delete operations."),
        mode: z
          .enum(["apply", "preview"])
          .optional()
          .describe("Apply now (default) or preview without writing."),
        confirm: z
          .boolean()
          .optional()
          .describe("Confirm any LSP change annotations that require confirmation."),
        projectRoot: z
          .string()
          .optional()
          .describe("Optional attached project root. Usually inferred from the first operation."),
      },
      outputSchema: {
        status: z.enum(["preview", "applied"]),
        files: z.array(z.string()),
        fileCount: z.number().int().nonnegative(),
        totalPreviewLines: z.number().int().nonnegative(),
        annotationCount: z.number().int().nonnegative(),
        warnings: z.array(z.string()),
      },
    },
    async (args, extra) => {
      const operations = args.operations as WorkspaceEditOperation[];
      const first = operations[0];
      if (!first) {
        throw new Error("edit_workspace requires at least one operation.");
      }
      const anchor = first.kind === "move" ? first.oldFile : first.file;
      const session = args.projectRoot
        ? await manager.getDiagnosticsSessionForProject(args.projectRoot)
        : await manager.getDiagnosticsSessionForFile(anchor);
      const result = await runGeneratedWorkspaceEdit(session, {
        mode: args.mode,
        confirm: args.confirm,
        requestMeta: extra._meta,
        signal: extra.signal,
        progress: (progress, message) => reportToolProgress(extra, progress, 6, message),
      }, async () => {
        const compiled = await compileWorkspaceOperations(
          session.rootDir,
          operations,
          extra.signal,
        );
        return compiled;
      });
      return {
        content: [{ type: "text", text: formatWorkspaceEditResult(result) }],
        structuredContent: {
          status: result.status,
          files: [...result.files],
          fileCount: result.files.length,
          totalPreviewLines: result.preview.split("\n").length,
          annotationCount: result.annotations.length,
          warnings: [...result.warnings],
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
        content: [{ type: "text", text: summary.text }],
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
    "rename_symbol",
    {
      title: "Rename Symbol",
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        "Rename a symbol across the workspace in one call using Volar's linked, embedded-aware rename edits. Applies by default; use preview to inspect without writing.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
        line: z.number().describe("Line number (1-based)"),
        col: z.number().describe("Column number (1-based)"),
        newName: z.string().describe("The replacement symbol name."),
        mode: z.enum(["apply", "preview"]).optional(),
        confirm: z.boolean().optional(),
      },
      outputSchema: {
        status: z.enum(["preview", "applied"]),
        files: z.array(z.string()),
        fileCount: z.number().int().nonnegative(),
        annotationCount: z.number().int().nonnegative(),
        warnings: z.array(z.string()),
      },
    },
    async (args, extra) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const result = await runGeneratedWorkspaceEdit(session, {
        mode: args.mode,
        confirm: args.confirm,
        requestMeta: extra._meta,
        signal: extra.signal,
        progress: (progress, message) => reportToolProgress(extra, progress, 6, message),
      }, async () => {
        const summary = await getRenameEdits(session, args, extra.signal);
        if (!summary.edit) throw new Error(summary.text);
        return { edit: summary.edit };
      });
      return {
        content: [{ type: "text", text: formatWorkspaceEditResult(result) }],
        structuredContent: {
          status: result.status,
          files: [...result.files],
          fileCount: result.files.length,
          annotationCount: result.annotations.length,
          warnings: [...result.warnings],
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
        content: [{ type: "text", text: summary.text }],
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
    "move_file",
    {
      title: "Move File",
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        "Move or rename a file and update TypeScript imports/references in one call. Volar produces the reference edits; the headless client composes the physical move.",
      inputSchema: {
        oldFile: z.string().describe(`Current file path. ${PROJECT_FILE_INPUT_DESCRIPTION}`),
        newFile: z.string().describe(`New file path. ${PROJECT_FILE_INPUT_DESCRIPTION}`),
        overwrite: z.boolean().optional(),
        mode: z.enum(["apply", "preview"]).optional(),
        confirm: z.boolean().optional(),
      },
      outputSchema: {
        status: z.enum(["preview", "applied"]),
        files: z.array(z.string()),
        fileCount: z.number().int().nonnegative(),
        annotationCount: z.number().int().nonnegative(),
        warnings: z.array(z.string()),
      },
    },
    async (args, extra) => {
      const session = await manager.getDiagnosticsSessionForFile(args.oldFile);
      const result = await runGeneratedWorkspaceEdit(session, {
        mode: args.mode,
        confirm: args.confirm,
        requestMeta: extra._meta,
        signal: extra.signal,
        progress: (progress, message) => reportToolProgress(extra, progress, 6, message),
      }, async () => {
        const summary = await getFileRenameEdits(session, args, extra.signal);
        if (!summary.edit) throw new Error(summary.text);
        return { edit: summary.edit };
      });
      return {
        content: [{ type: "text", text: formatWorkspaceEditResult(result) }],
        structuredContent: {
          status: result.status,
          files: [...result.files],
          fileCount: result.files.length,
          annotationCount: result.annotations.length,
          warnings: [...result.warnings],
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
      outputSchema: {
        actions: z.array(
          z.object({
            index: z.number().int().nonnegative(),
            title: z.string(),
            kind: z.string(),
            disabledReason: z.string().nullable(),
            hasEdit: z.boolean(),
            hasCommand: z.boolean(),
            isPreferred: z.boolean(),
            isResolvable: z.boolean(),
          }),
        ),
      },
    },
    async (args, extra) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const result = await getCodeActions(session, args, extra.signal);
      const actions = result.actions.map((action, index) => {
        const isCommand = typeof action.command === "string";
        const codeAction = isCommand ? null : action as CodeAction;
        return {
          index,
          title: action.title,
          kind: codeAction?.kind ?? (isCommand ? "command" : "quickfix"),
          disabledReason: codeAction?.disabled?.reason ?? null,
          hasEdit: codeAction?.edit !== undefined,
          hasCommand: isCommand || codeAction?.command !== undefined,
          isPreferred: codeAction?.isPreferred === true,
          isResolvable: codeAction?.data != null,
        };
      });
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: { actions },
      };
    },
  );

  server.registerTool(
    "apply_code_action",
    {
      title: "Apply Code Action",
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        "Resolve and apply one Volar code action selected by title and optional kind. The edit is applied before an advertised server command; editor commands are returned as explicit follow-up metadata.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
        startLine: z.number().describe("Start line (1-based)"),
        startCol: z.number().describe("Start column (1-based)"),
        endLine: z.number().describe("End line (1-based)"),
        endCol: z.number().describe("End column (1-based)"),
        index: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Action index returned by get_code_actions. Preferred when titles repeat."),
        title: z
          .string()
          .optional()
          .describe("Exact action title returned by get_code_actions."),
        kind: z.string().optional().describe("Optional exact action kind to disambiguate titles."),
        mode: z.enum(["apply", "preview"]).optional(),
        confirm: z.boolean().optional(),
      },
      outputSchema: {
        status: z.enum(["preview", "applied", "executed", "follow_up"]),
        files: z.array(z.string()),
        fileCount: z.number().int().nonnegative(),
        annotationCount: z.number().int().nonnegative(),
        warnings: z.array(z.string()),
        followUp: z.object({
          command: z.string(),
          arguments: z.array(z.unknown()),
        }).nullable(),
      },
    },
    async (args, extra) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const progress = (value: number, message: string): Promise<void> =>
        reportToolProgress(extra, value, 6, message);
      await progress(0, (args.mode ?? "apply") === "apply"
        ? "Waiting for workspace mutation lock"
        : "Inspecting code actions");
      const run = async (apply: LockedWorkspaceEditApplier | null) => {
        await progress(1, "Fetching code actions");
        const actions = await getCodeActions(session, args, extra.signal);
        if (args.index === undefined && args.title === undefined) {
          throw new Error("apply_code_action requires an action index or exact title.");
        }
        const matches = actions.actions.filter((candidate, index) => {
          const isCommand = typeof candidate.command === "string";
          const codeAction = isCommand ? null : candidate as CodeAction;
          return (args.index === undefined || index === args.index)
            && (args.title === undefined || candidate.title === args.title)
            && (args.kind === undefined
              || (codeAction?.kind ?? (isCommand ? "command" : "quickfix")) === args.kind);
        });
        if (matches.length !== 1) {
          throw new Error(
            matches.length === 0
              ? "No code action matched the requested selector."
              : "The code action selector is ambiguous; pass its returned index.",
          );
        }
        const selected = matches[0]!;
        const isCommand = typeof selected.command === "string";
        await progress(2, "Resolving selected code action");
        const codeAction = isCommand
          ? null
          : await session.resolveFileCodeAction(selected as CodeAction, extra.signal);
        if (codeAction?.disabled) throw new Error(codeAction.disabled.reason);
        const command = isCommand ? selected as Command : codeAction?.command;
        const editorCommand = command && EDITOR_COMMANDS.has(command.command);
        if (command && !editorCommand && !session.canExecuteCommand(command.command)) {
          throw new Error(
            `Code action requires client command ${command.command}, which the language server did not advertise.`,
          );
        }
        const results: WorkspaceEditResult[] = [];
        const applyEdit = async (edit: WorkspaceEdit): Promise<WorkspaceEditResult> => apply
          ? apply(edit, {
              confirm: await confirmWorkspaceEdit(edit, args.confirm),
              ...workspaceEditExecutionHooks(
                session,
                extra._meta,
                extra.signal,
                progress,
              ),
            })
          : runWorkspaceEdit(session, edit, {
              mode: "preview",
              confirm: args.confirm,
              requestMeta: extra._meta,
              signal: extra.signal,
            });
        if (codeAction?.edit) results.push(await applyEdit(codeAction.edit));
        if (!apply) {
          if (results.length === 0) {
            throw new Error("Command-only code actions cannot be previewed without executing them.");
          }
        } else if (command && !editorCommand) {
          let commandFailure: string | null = null;
          await manager.executeCommand(
            session.rootDir,
            command,
            async (edit) => {
              try {
                results.push(await applyEdit(edit));
                return { applied: true };
              } catch (error) {
                commandFailure = error instanceof Error ? error.message : String(error);
                return { applied: false, failureReason: commandFailure };
              }
            },
            extra.signal,
          );
          if (commandFailure) throw new Error(commandFailure);
        }
        const followUp = editorCommand && command
          ? { command: command.command, arguments: command.arguments ?? [] }
          : null;
        const combined = results.length > 0 ? combineWorkspaceEditResults(results) : null;
        const status = combined?.status ?? (followUp ? "follow_up" : "executed");
        const text = [
          combined ? formatWorkspaceEditResult(combined) : `Executed code action ${selected.title}.`,
          followUp
            ? `Follow-up editor command required: ${followUp.command} ${JSON.stringify(followUp.arguments)}`
            : "",
        ].filter(Boolean).join("\n\n");
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            status,
            files: combined ? [...combined.files] : [],
            fileCount: combined?.files.length ?? 0,
            annotationCount: combined?.annotations.length ?? 0,
            warnings: combined ? [...combined.warnings] : [],
            followUp,
          },
        };
      };
      const result = (args.mode ?? "apply") === "preview"
        ? run(null)
        : withWorkspaceEditTransaction(session.rootDir, extra.signal, run);
      const completed = await result;
      await progress(6, "Code action complete");
      return completed;
    },
  );

  server.registerTool(
    "format_file",
    {
      title: "Format File",
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        "Format one file with Volar's document-formatting pipeline and apply the returned edits. Applies by default; use preview to inspect without writing.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
        tabSize: z.number().int().positive().optional(),
        insertSpaces: z.boolean().optional(),
        mode: z.enum(["apply", "preview"]).optional(),
        confirm: z.boolean().optional(),
      },
      outputSchema: {
        status: z.enum(["preview", "applied", "unchanged"]),
        files: z.array(z.string()),
        fileCount: z.number().int().nonnegative(),
        warnings: z.array(z.string()),
      },
    },
    async (args, extra) => {
      const session = await manager.getDiagnosticsSessionForFile(args.file);
      const progress = (value: number, message: string): Promise<void> =>
        reportToolProgress(extra, value, 6, message);
      const generate = async () => {
        const edit = await getFormattingEdit(
          session,
          args.file,
          {
            tabSize: args.tabSize ?? 2,
            insertSpaces: args.insertSpaces ?? true,
          },
          extra.signal,
        );
        return edit;
      };
      await progress(0, (args.mode ?? "apply") === "apply"
        ? "Waiting for workspace mutation lock"
        : "Generating formatting preview");
      const result = (args.mode ?? "apply") === "preview"
        ? await (async () => {
            await progress(1, "Generating formatting edits");
            const edit = await generate();
            return edit
              ? runWorkspaceEdit(session, edit, {
                  mode: "preview",
                  confirm: args.confirm,
                  requestMeta: extra._meta,
                  signal: extra.signal,
                })
              : null;
          })()
        : await withWorkspaceEditTransaction(session.rootDir, extra.signal, async (apply) => {
            await progress(1, "Generating formatting edits");
            const edit = await generate();
            if (!edit) return null;
            await progress(2, "Checking workspace edit confirmation");
            return apply(edit, {
              confirm: await confirmWorkspaceEdit(edit, args.confirm),
              ...workspaceEditExecutionHooks(
                session,
                extra._meta,
                extra.signal,
                progress,
              ),
            });
          });
      await progress(6, result ? "Formatting complete" : "File already formatted");
      if (!result) {
        return {
          content: [{ type: "text", text: `${args.file} is already formatted.` }],
          structuredContent: {
            status: "unchanged" as const,
            files: [],
            fileCount: 0,
            warnings: [],
          },
        };
      }
      return {
        content: [{ type: "text", text: formatWorkspaceEditResult(result) }],
        structuredContent: {
          status: result.status,
          files: [...result.files],
          fileCount: result.files.length,
          warnings: [...result.warnings],
        },
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
        "Read a file through either the default compact implementation lane or an exact, revision-bearing source lane. Use mode='exact' before whole-file write, move, or delete operations and for implementation bodies that must not be folded. Exact reads support bounded line ranges.",
      inputSchema: {
        file: z.string().describe(PROJECT_FILE_INPUT_DESCRIPTION),
        mode: z
          .enum(["compact", "exact"])
          .optional()
          .describe("Compact folding-aware source (default) or exact source with a revision."),
        startLine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("First 1-based source line for an exact ranged read."),
        endLine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Last inclusive 1-based source line for an exact ranged read."),
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
      if ((args.mode ?? "compact") === "exact") {
        const exact = await readWorkspaceFile(session.rootDir, args.file);
        const content = exact.snapshot.content ?? "";
        const lines = content.split("\n");
        const totalLines = content.length === 0
          ? 0
          : lines.length - (content.endsWith("\n") ? 1 : 0);
        const startLine = args.startLine ?? (totalLines === 0 ? 0 : 1);
        const endLine = args.endLine ?? totalLines;
        if (startLine > endLine && totalLines > 0) {
          throw new Error("read_file startLine must be less than or equal to endLine.");
        }
        if (endLine > totalLines) {
          throw new Error(
            `read_file endLine ${endLine} exceeds ${exact.file}'s ${totalLines} source lines.`,
          );
        }
        const selected = totalLines === 0
          ? ""
          : lines.slice(startLine - 1, endLine).join("\n")
            + (endLine === totalLines && content.endsWith("\n") ? "\n" : "");
        const text = args.lineNumbers && selected.length > 0
          ? selected
            .split("\n")
            .map((line, index) => {
              if (index === selected.split("\n").length - 1 && line === "") {
                return "";
              }
              return `${String(startLine + index).padStart(String(endLine).length, " ")} │ ${line}`;
            })
            .join("\n")
          : selected;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            file: exact.file,
            mode: "exact",
            revision: exact.snapshot.revision,
            byteCount: Buffer.byteLength(content, "utf8"),
            totalLines,
            startLine,
            endLine,
          },
        };
      }
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
        "Inspect a symbol by position or by query. Combines hover/type info, definition, type definition, implementations, and references. On request, it can also include complete source lines for the symbol and direct same-file callees selected by Volar's semantic ranges.",
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
            "Volar workspace-symbol query, narrowed to this file. Use when you do not have an exact position.",
          ),
        maxReferences: z
          .number()
          .int()
          .min(0)
          .max(20)
          .optional()
          .describe(
            "Maximum number of non-declaration reference lines to include. Pass 0 for the count only. Defaults to 3.",
          ),
        includeSource: z
          .boolean()
          .default(false)
          .describe(
            "With query, include complete source lines for the selected symbol and direct same-file callees, with 1-based end-exclusive source and symbol ranges for follow-up edits. Nested callees already inside the symbol are not repeated. Defaults to false.",
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
