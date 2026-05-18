import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  createInMemoryTestClient,
  createStdioTestClient,
  demoWorkspaceRoot,
  readStructuredContent,
  readTextContent,
  runBasicProbe,
  type TestClientHandle,
} from "./testing.js";

const previousRuntimeMode = process.env.FEATURETYPE_RUNTIME_MODE;
const previousStateFile = process.env.FEATURETYPE_MCP_STATE_FILE;

async function expectBasicProbe(handle: TestClientHandle) {
  const probe = await runBasicProbe(handle.client);
  const totalCount = Number(probe.diagnosticsStructured?.totalCount ?? 0);

  expect(probe.toolCount).toBeGreaterThan(10);
  expect(probe.toolNames).toContain("get_diagnostics");
  expect(probe.toolNames).toContain("get_hover");
  expect(probe.projectRoots).toContain(demoWorkspaceRoot);
  expect(probe.hoverText.length).toBeGreaterThan(0);
  expect(probe.diagnosticsText).toContain("broken-button.featuretype");
  expect(totalCount).toBeGreaterThan(0);
}

function hasToolError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "isError" in result &&
    result.isError === true
  );
}

async function withDiagnosticRateLimitConfig<T>(
  maxCalls: string,
  windowMs: string,
  work: () => Promise<T>,
): Promise<T> {
  const previousMaxCalls =
    process.env.FEATURETYPE_DIAGNOSTIC_TOOL_MAX_CALLS_PER_MINUTE;
  const previousWindowMs = process.env.FEATURETYPE_DIAGNOSTIC_TOOL_WINDOW_MS;
  process.env.FEATURETYPE_DIAGNOSTIC_TOOL_MAX_CALLS_PER_MINUTE = maxCalls;
  process.env.FEATURETYPE_DIAGNOSTIC_TOOL_WINDOW_MS = windowMs;

  try {
    return await work();
  } finally {
    if (previousMaxCalls === undefined) {
      delete process.env.FEATURETYPE_DIAGNOSTIC_TOOL_MAX_CALLS_PER_MINUTE;
    } else {
      process.env.FEATURETYPE_DIAGNOSTIC_TOOL_MAX_CALLS_PER_MINUTE = previousMaxCalls;
    }

    if (previousWindowMs === undefined) {
      delete process.env.FEATURETYPE_DIAGNOSTIC_TOOL_WINDOW_MS;
    } else {
      process.env.FEATURETYPE_DIAGNOSTIC_TOOL_WINDOW_MS = previousWindowMs;
    }
  }
}

async function createTemporaryProject(
  parentDir: string,
  symbolName: string,
): Promise<string> {
  const projectRoot = await mkdtemp(path.join(parentDir, `${symbolName.toLowerCase()}-`));
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(projectRoot, "src", `${symbolName.toLowerCase()}.ts`),
    `export const ${symbolName} = "${symbolName}";\n`,
  );
  return projectRoot;
}

async function createPackageResolutionProject(parentDir: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(parentDir, "featuretype-mcp-package-resolution-"));
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(projectRoot, "src", "index.ts"),
    "export const localValue = 1;\n",
  );
  return projectRoot;
}

async function createInvalidFenceProject(parentDir: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(parentDir, "featuretype-mcp-invalid-fences-"));
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
        },
        include: ["**/*"],
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(projectRoot, "shadow.ts"), "export const real = true;\n");
  await writeFile(
    path.join(projectRoot, "invalid.featuretype"),
    [
      "# Invalid",
      "",
      "```ts",
      "// ../outside.ts",
      "export const outside = true",
      "```",
      "",
      "```ts",
      "// /absolute.ts",
      "export const absolute = true",
      "```",
      "",
      "```ts",
      "// https://example.com/module.ts",
      "export const url = true",
      "```",
      "",
      "```ts",
      "// ./missing-extension",
      "export const missing = true",
      "```",
      "",
      "```tsx",
      "// ./view.ts",
      "export const view = true",
      "```",
      "",
      "```ts",
      "// ./dup.ts",
      "export const first = true",
      "```",
      "",
      "```ts",
      "// ./dup.ts",
      "export const second = true",
      "```",
      "",
      "```ts",
      "// ./shadow.ts",
      "export const shadow = true",
      "```",
    ].join("\n"),
  );
  return projectRoot;
}

async function createMixedExportsProject(parentDir: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(parentDir, "featuretype-mcp-mixed-exports-"));
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          verbatimModuleSyntax: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(projectRoot, "src", "consumer.ts"), "export {};\n");
  await writeFile(
    path.join(projectRoot, "src", "mixed.ts"),
    [
      "export const runtimeValue = 1;",
      "export function runtimeFunction(input: string): string {",
      "  return input.toUpperCase();",
      "}",
      "export class RuntimeClass {",
      "  readonly kind = \"runtime\";",
      "}",
      "export enum RuntimeEnum {",
      "  Primary = \"primary\",",
      "}",
      "export interface TypeShape {",
      "  label: string;",
      "}",
      "export type TypeAlias = string;",
      "",
    ].join("\n"),
  );
  return projectRoot;
}

async function createCollapsedFileProject(parentDir: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(parentDir, "featuretype-mcp-collapsed-file-"));
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          jsx: "react-jsx",
        },
        include: ["src/**/*.tsx", "src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(projectRoot, "src", "view.tsx"),
    [
      "import {",
      "  Suspense,",
      "  useMemo,",
      '} from "react";',
      "",
      "/**",
      " * Build a noisy panel so collapsed-file output can trim implementation detail.",
      " */",
      "export function DashboardPanel(props: { title: string; values: number[] }) {",
      "  const stats = useMemo(",
      "    () =>",
      "      props.values.map((value) => ({",
      "        value,",
      "        doubled: value * 2,",
      "      })),",
      "    [props.values],",
      "  );",
      "",
      "  return (",
      "    <section>",
      "      <header>",
      "        <h2>{props.title}</h2>",
      "      </header>",
      "      <Suspense fallback={<span>Loading</span>}>",
      "        <pre>{JSON.stringify(stats, null, 2)}</pre>",
      "      </Suspense>",
      "    </section>",
      "  );",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "src", "imports.ts"),
    [
      "import {",
      "  Suspense,",
      "  useMemo,",
      '} from "react";',
      'import type { Token } from "./tokens.js";',
      "import {",
      "  readToken,",
      "  writeToken,",
      '} from "./tokens.js";',
      "",
      "export const runtimeValue = readToken(writeToken as Token);",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "src", "tokens.ts"),
    [
      "export type Token = string;",
      "export const readToken = (token: Token): Token => token;",
      "export const writeToken = (token: Token): Token => token;",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "src", "auth-session.ts"),
    [
      "export type AuthSession = {",
      "  userId: string;",
      "  token: string;",
      "};",
      "",
      "export function isAuthenticated(session: AuthSession | null): boolean {",
      "  return Boolean(session?.token);",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "src", "use-auth.ts"),
    [
      'import { useRouter } from "@tanstack/react-router";',
      'import { useCurrentUser } from "./current-user.js";',
      "",
      "export function useAuth() {",
      "  const router = useRouter();",
      "  const currentUser = useCurrentUser();",
      "  const isAuthenticated = currentUser !== null;",
      "  const displayName = currentUser?.displayName ?? null;",
      "  const hasLogin = (currentUser?.login ?? \"\").length > 0;",
      "",
      "  return {",
      "    currentUser,",
      "    displayName,",
      "    hasLogin,",
      "    isAuthenticated,",
      "    navigateToSignIn: () => {",
      "      void router.navigate({ to: \"/signin\" });",
      "    },",
      "    navigateToSettings: () => {",
      "      void router.navigate({ to: \"/settings\" });",
      "    },",
      "  };",
      "}",
      "",
      "export const authLabel = \"auth\";",
      "export const authEnabled = true;",
      "export const authStatus = authEnabled ? authLabel : \"disabled\";",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "src", "current-user.ts"),
    [
      "export type CurrentUser = {",
      "  displayName: string | null;",
      "  login: string | null;",
      "};",
      "",
      "export function useCurrentUser(): CurrentUser | null {",
      "  return null;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "src", "shapes.ts"),
    [
      "export interface DashboardSummary {",
      "  id: string;",
      "  title: string;",
      "  description: string;",
      "  tags: string[];",
      "  createdAt: string;",
      "  updatedAt: string;",
      "  owner: {",
      "    id: string;",
      "    name: string;",
      "  };",
      "}",
      "",
      "export type DashboardLoadState =",
      "  | { status: \"idle\" }",
      "  | { status: \"loading\" }",
      "  | { status: \"ready\"; summary: DashboardSummary }",
      "  | { status: \"error\"; message: string };",
      "",
      "export const READY_STATUS = \"ready\";",
      "export const EMPTY_SUMMARY_ID = \"root\";",
      "export const EMPTY_TITLE = \"All dashboards\";",
      "export const EMPTY_DESCRIPTION = \"\";",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "src", "dashboard-page.tsx"),
    [
      'import { useCallback, useEffect, useMemo, useState } from "react";',
      "",
      "export function DashboardPage() {",
      "  const [search, setSearch] = useState(\"\");",
      "  const [topic, setTopic] = useState<string | null>(null);",
      "",
      "  useEffect(() => {",
      "    const controller = new AbortController();",
      "    const requestId = search.length + (topic?.length ?? 0);",
      "    const shouldTrack = requestId > 0;",
      "    if (shouldTrack) {",
      "      void controller.signal;",
      "    }",
      "    return () => controller.abort();",
      "  }, [search, topic]);",
      "",
      "  const onSelectTopic = useCallback((nextTopic: string | null) => {",
      "    setTopic(nextTopic);",
      "    setSearch(nextTopic ?? \"\");",
      "    const nextValue = nextTopic ?? \"all\";",
      "    const isReset = nextTopic === null;",
      "    return isReset ? nextValue : `${nextValue}!`;",
      "  }, []);",
      "",
      "  const summary = useMemo(() => {",
      "    const topicLabel = topic ?? \"all\";",
      "    const searchLabel = search || \"empty\";",
      "    const uppercaseLabel = searchLabel.toUpperCase();",
      "    const summaryValue = `${uppercaseLabel}:${topicLabel}`;",
      "    return summaryValue;",
      "  }, [search, topic]);",
      "",
      "  return (",
      "    <section>",
      "      <div>{summary}</div>",
      "      <button onClick={() => onSelectTopic(null)}>Reset</button>",
      "      <span>{search}</span>",
      "    </section>",
      "  );",
      "}",
      "",
    ].join("\n"),
  );
  return projectRoot;
}

async function createBundlerProjectWithMissingImport(
  parentDir: string,
): Promise<string> {
  const projectRoot = await mkdtemp(path.join(parentDir, "featuretype-mcp-bundler-"));
  const srcDir = path.join(projectRoot, "src");

  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(srcDir, "index.ts"),
    [
      'import { createdValue } from "./created.ts";',
      "",
      "export const currentValue: string = createdValue;",
      "",
    ].join("\n"),
  );

  return projectRoot;
}

async function createConfigRefreshProject(parentDir: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(parentDir, "featuretype-mcp-config-refresh-"));
  const srcDir = path.join(projectRoot, "src");

  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
        },
        files: ["src/a.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(srcDir, "a.ts"), "export const a = 1;\n");
  await writeFile(path.join(srcDir, "b.ts"), "export const b: string = 1;\n");

  return projectRoot;
}

async function createRepoTempDir(prefix: string): Promise<string> {
  const repoTempRoot = path.join(
    path.resolve(demoWorkspaceRoot, "..", ".."),
    ".tmp-mcp-tests",
  );
  await mkdir(repoTempRoot, { recursive: true });
  return await mkdtemp(path.join(repoTempRoot, prefix));
}

async function createTemporaryReferencedMonorepo(parentDir: string): Promise<{
  root: string;
  appRoot: string;
}> {
  const root = await mkdtemp(path.join(parentDir, "featuretype-mcp-monorepo-"));
  const appRoot = path.join(root, "apps", "web");

  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(appRoot, "src"), { recursive: true });

  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
        },
        include: ["src/**/*.ts", "apps/web/src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(root, "src", "root.ts"), "export const rootValue = 1;\n");

  await writeFile(
    path.join(appRoot, "tsconfig.json"),
    JSON.stringify(
      {
        files: [],
        references: [{ path: "./tsconfig.app.json" }],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(appRoot, "tsconfig.app.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(appRoot, "src", "router.ts"),
    "const broken: string = 1;\nexport { broken };\n",
  );

  return { root, appRoot };
}

async function createLargeDiagnosticProject(parentDir: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(parentDir, "featuretype-mcp-large-project-"));
  const srcDir = path.join(projectRoot, "src");

  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );

  await Promise.all(
    Array.from({ length: 260 }, (_, index) =>
      writeFile(
        path.join(srcDir, `file-${index}.ts`),
        index === 0
          ? "const broken: string = 1;\nexport { broken };\n"
          : `export const value${index} = ${index};\n`,
      ),
    ),
  );

  return projectRoot;
}

async function createReferenceSummaryProject(parentDir: string): Promise<string> {
  const projectRoot = await mkdtemp(
    path.join(parentDir, "featuretype-mcp-reference-summary-"),
  );
  const srcDir = path.join(projectRoot, "src");

  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(srcDir, "shared.ts"),
    "export const sharedValue = 1;\n",
  );
  await writeFile(
    path.join(srcDir, "a.ts"),
    [
      'import { sharedValue } from "./shared.js";',
      "export const first = sharedValue;",
      "",
      "export function readAgain() {",
      "  return sharedValue;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(srcDir, "b.ts"),
    [
      'import { sharedValue } from "./shared.js";',
      "",
      "export const second = sharedValue + 1;",
      "",
    ].join("\n"),
  );

  return projectRoot;
}

async function createValidationProject(parentDir: string): Promise<string> {
  const projectRoot = await mkdtemp(
    path.join(parentDir, "featuretype-mcp-validate-files-"),
  );
  const srcDir = path.join(projectRoot, "src");

  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(srcDir, "a.ts"),
    "export const first: string = \"ok\";\n",
  );
  await writeFile(
    path.join(srcDir, "b.ts"),
    "export const second: string = \"ok\";\n",
  );

  return projectRoot;
}

describe("featuretype MCP local probes", () => {
  let handle: TestClientHandle | undefined;
  let tempDir: string | undefined;
  let stateDir: string | undefined;

  beforeAll(() => {
    process.env.FEATURETYPE_RUNTIME_MODE = "source";
  });

  beforeEach(async () => {
    stateDir = await createRepoTempDir("featuretype-mcp-state-");
    process.env.FEATURETYPE_MCP_STATE_FILE = path.join(stateDir, "state.json");
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    if (stateDir) {
      await rm(stateDir, { recursive: true, force: true });
      stateDir = undefined;
    }
  });

  afterAll(() => {
    if (previousRuntimeMode === undefined) {
      delete process.env.FEATURETYPE_RUNTIME_MODE;
    } else {
      process.env.FEATURETYPE_RUNTIME_MODE = previousRuntimeMode;
    }

    if (previousStateFile === undefined) {
      delete process.env.FEATURETYPE_MCP_STATE_FILE;
      return;
    }
    process.env.FEATURETYPE_MCP_STATE_FILE = previousStateFile;
  });

  it("supports in-memory MCP probing without Codex or stdio", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);
    await expectBasicProbe(handle);
  });

  it("supports stdio MCP probing without rebinding Codex", async () => {
    handle = await createStdioTestClient(demoWorkspaceRoot);
    await expectBasicProbe(handle);
  });

  it("surfaces conventional MCP tool metadata for agent discovery", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const { tools } = await handle.client.listTools();
    const diagnosticsTool = tools.find((tool) => tool.name === "get_diagnostics");
    const openVirtualFileTool = tools.find((tool) => tool.name === "open_virtual_file");
    const closeVirtualFileTool = tools.find((tool) => tool.name === "close_virtual_file");

    expect(diagnosticsTool?.title).toBe("Get Diagnostics");
    expect(diagnosticsTool?.annotations?.readOnlyHint).toBe(true);
    expect(diagnosticsTool?.annotations?.openWorldHint).toBe(false);
    expect(diagnosticsTool?.description).toContain("summary mode");
    expect(JSON.stringify(diagnosticsTool?.inputSchema ?? {})).toContain(
      "list_projects",
    );
    expect(JSON.stringify(diagnosticsTool?.inputSchema ?? {})).toContain(
      "attach_project",
    );

    expect(openVirtualFileTool?.title).toBe("Open Virtual File");
    expect(openVirtualFileTool?.annotations?.destructiveHint).toBe(false);
    expect(openVirtualFileTool?.annotations?.idempotentHint).toBe(true);
    expect(openVirtualFileTool?.annotations?.openWorldHint).toBe(false);

    expect(closeVirtualFileTool?.title).toBe("Close Virtual File");
    expect(closeVirtualFileTool?.annotations?.destructiveHint).toBe(true);
    expect(closeVirtualFileTool?.annotations?.idempotentHint).toBe(true);
    expect(closeVirtualFileTool?.annotations?.openWorldHint).toBe(false);
  });

  it("makes attached project state actionable for wrong-root recovery", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-project-guidance-");
    const alphaRoot = await createTemporaryProject(tempDir, "AlphaGuidanceSymbol");
    const betaRoot = await createTemporaryProject(tempDir, "BetaGuidanceSymbol");

    handle = await createInMemoryTestClient(alphaRoot);
    await handle.client.callTool({
      name: "attach_project",
      arguments: {
        projectRoot: betaRoot,
      },
    });

    const result = await handle.client.callTool({
      name: "list_projects",
      arguments: {},
    });
    const text = readTextContent(result);

    expect(text).toContain(`Active project root: ${betaRoot}`);
    expect(text).toContain("* ");
    expect(text).toContain("different repo or worktree");
    expect(text).toContain("not a blocker");
    expect(text).toContain("attach_project");
  }, 60_000);

  it("explains project routing when a file misses the active project", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-project-miss-");
    const projectRoot = await createTemporaryProject(tempDir, "MissingGuidanceSymbol");

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        file: "src/not-here.ts",
        summary: true,
      },
    });
    const text = readTextContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("Project routing:");
    expect(text).toContain(`Interpreted against: ${projectRoot}`);
    expect(text).toContain("not a blocker");
    expect(text).toContain("list_projects");
    expect(text).toContain("attach_project");
    expect(
      (readStructuredContent(result)?.error as { code?: string } | undefined)?.code,
    ).toBe("NOT_FOUND");
  }, 60_000);

  it("keeps find_errors_and_fixes text output compact by default", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const result = await handle.client.callTool({
      name: "find_errors_and_fixes",
      arguments: {
        file: "broken-button.featuretype",
        severity: "all",
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(text).toContain("broken-button.featuretype");
    expect(text).not.toContain("→");
    expect(Number(structured?.totalCount ?? 0)).toBeGreaterThan(0);
    expect(structured?.items).toBeUndefined();
  });

  it("typechecks one project file with a simple text result", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const passed = await handle.client.callTool({
      name: "typecheck_file",
      arguments: {
        file: "clean.ts",
      },
    });
    const failed = await handle.client.callTool({
      name: "typecheck_file",
      arguments: {
        file: "broken-button.featuretype",
      },
    });

    expect(readTextContent(passed)).toBe(
      "Typecheck passed: clean.ts",
    );
    expect(readStructuredContent(passed)).toBeUndefined();
    expect(readTextContent(failed)).toContain(
      "Typecheck failed: broken-button.featuretype",
    );
    expect(readTextContent(failed)).toContain("TS2322");
    expect(readStructuredContent(failed)).toBeUndefined();
  });

  it("includes structured fix items when explicitly enabled", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const result = await handle.client.callTool({
      name: "find_errors_and_fixes",
      arguments: {
        file: "broken-button.featuretype",
        severity: "all",
        includeItems: true,
      },
    });

    const items =
      (readStructuredContent(result)?.items as Array<{
        line?: number;
        code?: string;
        fixes?: Array<{ title?: string; kind?: string }>;
      }> | undefined) ?? [];

    expect(items).toMatchObject([
      {
        line: 7,
        code: "TS2322",
        fixes: [],
      },
    ]);
  });

  it("only reports applicable fixes in both compact text and repeated item output", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const compact = await handle.client.callTool({
      name: "find_errors_and_fixes",
      arguments: {
        file: "broken-button.featuretype",
        severity: "all",
      },
    });
    const detailed = await handle.client.callTool({
      name: "find_errors_and_fixes",
      arguments: {
        file: "broken-button.featuretype",
        severity: "all",
        includeItems: true,
      },
    });

    const compactText = readTextContent(compact);
    const items =
      (readStructuredContent(detailed)?.items as Array<{
        line?: number;
        code?: string;
        fixes?: Array<{ title?: string }>;
      }> | undefined) ?? [];

    expect(compactText).toContain(
      "TS2322  Type '\"destructive\"' is not assignable to type '\"primary\" | \"danger\" | undefined'.",
    );
    expect(compactText).not.toContain("fix:");
    expect(items).toMatchObject([
      {
        line: 7,
        code: "TS2322",
        fixes: [],
      },
    ]);
  });

  it("inspects symbols inside .featuretype TypeScript fences through same-file imports", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const result = await handle.client.callTool({
      name: "inspect_symbol",
      arguments: {
        file: "same-file-import.featuretype",
        line: 7,
        col: 22,
        maxReferences: 5,
      },
    });
    const text = readTextContent(result);

    expect(text).toContain("Definition:");
    expect(text).toContain("References");
    expect(text).toContain("same-file-import.featuretype");
    expect(text).toContain("helper(value: string)");
    expect(text).not.toContain("helper.ts:");
    expect(text).not.toContain("volar-embedded-content:");
  });

  it("inspects fenced TypeScript symbols by query through document symbols", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const result = await handle.client.callTool({
      name: "inspect_symbol",
      arguments: {
        file: "same-file-import.featuretype",
        query: "helper",
        maxReferences: 5,
      },
    });
    const text = readTextContent(result);

    expect(text).toContain("Matched \"helper\"");
    expect(text).toContain("Definition:");
    expect(text).toContain("same-file-import.featuretype");
    expect(text).toContain("helper(value: string)");
    expect(text).not.toContain("helper.ts:");
    expect(text).not.toContain("volar-embedded-content:");
  });

  it("shows fenced modules and TypeScript child symbols in the document outline", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const result = await handle.client.callTool({
      name: "get_document_symbols",
      arguments: {
        file: "same-file-import.featuretype",
        maxDepth: 2,
      },
    });
    const text = readTextContent(result);

    expect(text).toContain("module ./root.ts");
    expect(text).toContain("variable root");
    expect(text).toContain("module ./helper.ts");
    expect(text).toContain("function helper");
  });

  it("explains .featuretype positions outside TypeScript fence bodies", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const result = await handle.client.callTool({
      name: "inspect_symbol",
      arguments: {
        file: "same-file-import.featuretype",
        line: 1,
        col: 3,
      },
    });
    const text = readTextContent(result);

    expect(text).toContain("Reason: position may not be inside a ts or tsx code fence.");
    expect(text).toContain("Semantic queries work inside Markdown fences");
    expect(text).toContain("Prose, headings, fence metadata, and non-TypeScript fences");
  });

  it("surfaces all structural fence diagnostics through MCP diagnostics", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-invalid-fences-parent-");
    const projectRoot = await createInvalidFenceProject(tempDir);
    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        file: "invalid.featuretype",
        severity: "all",
        summary: false,
      },
    });
    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(structured?.totalCount).toBe(7);
    expect(text).toContain('code="invalid-fence-file"');
    expect(text).toContain('code="fence-extension-mismatch"');
    expect(text).toContain('code="duplicate-fence-file"');
    expect(text).toContain('code="fence-file-shadows-real-file"');
    expect(text).toContain("Fence file paths cannot shadow a real file");
  }, 60_000);

  it("rate-limits get_diagnostics after configured max calls per window", async () => {
    await withDiagnosticRateLimitConfig("1", "60000", async () => {
      handle = await createInMemoryTestClient(demoWorkspaceRoot);

      const first = await handle.client.callTool({
        name: "get_diagnostics",
        arguments: {
          file: "broken-button.featuretype",
          severity: "all",
        },
      });
      const second = await handle.client.callTool({
        name: "get_diagnostics",
        arguments: {
          file: "broken-button.featuretype",
          severity: "all",
        },
      });

      expect(hasToolError(first)).toBe(false);
      expect(hasToolError(second)).toBe(true);
      expect(
        (readStructuredContent(second)?.error as
          | { code?: string; message?: string }
          | undefined)?.code,
      ).toBe("RATE_LIMIT_EXCEEDED");
      expect(readTextContent(second)).toContain("Retry after");
    });
  });

  it("rate-limits find_errors_and_fixes after configured max calls per window", async () => {
    await withDiagnosticRateLimitConfig("1", "60000", async () => {
      handle = await createInMemoryTestClient(demoWorkspaceRoot);

      const first = await handle.client.callTool({
        name: "find_errors_and_fixes",
        arguments: {
          file: "broken-button.featuretype",
          severity: "all",
        },
      });
      const second = await handle.client.callTool({
        name: "find_errors_and_fixes",
        arguments: {
          file: "broken-button.featuretype",
          severity: "all",
        },
      });

      expect(hasToolError(first)).toBe(false);
      expect(hasToolError(second)).toBe(true);
      expect(
        (readStructuredContent(second)?.error as
          | { code?: string; message?: string }
          | undefined)?.code,
      ).toBe("RATE_LIMIT_EXCEEDED");
      expect(readTextContent(second)).toContain("Retry after");
    });
  });

  it("returns structured NOT_FOUND failures for missing semantic files", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const result = await handle.client.callTool({
      name: "get_hover",
      arguments: {
        file: "does-not-exist.ts",
        line: 1,
        col: 1,
      },
    });

    expect(hasToolError(result)).toBe(false);
    expect(readTextContent(result)).toContain("does not exist");
    expect(
      (readStructuredContent(result)?.error as { code?: string } | undefined)?.code,
    ).toBe("NOT_FOUND");
  });

  it("summarizes references by file with structured output", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-reference-summary-parent-");
    const projectRoot = await createReferenceSummaryProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "get_reference_summary",
      arguments: {
        file: "src/shared.ts",
        line: 1,
        col: 14,
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(text).toContain("references across");
    expect(text).toContain('import { sharedValue } from "./shared.js";');
    expect(text).toContain("src/a.ts (3)");
    expect(Number(structured?.totalReferences ?? 0)).toBe(6);
    expect(Number(structured?.totalFiles ?? 0)).toBe(3);
    expect(
      (structured?.files as Array<{ file?: string; count?: number }> | undefined)?.[0],
    ).toMatchObject({
      file: "src/a.ts",
      count: 3,
    });
  }, 60_000);

  it("validates several changed files in one tool call", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-validate-files-parent-");
    const projectRoot = await createValidationProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    await writeFile(
      path.join(projectRoot, "src", "a.ts"),
      "export const first: string = 1;\n",
    );
    await writeFile(
      path.join(projectRoot, "src", "b.ts"),
      "export const second: string = 2;\n",
    );

    const result = await handle.client.callTool({
      name: "validate_files",
      arguments: {
        files: ["src/a.ts", "src/b.ts"],
        severity: "all",
        includeItems: true,
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);
    const items =
      (structured?.items as Array<{ file?: string; fixes?: unknown[] }> | undefined) ?? [];

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("Validated 2 files.");
    expect(Number(structured?.fileCount ?? 0)).toBe(2);
    expect(Number(structured?.totalErrorCount ?? 0)).toBe(2);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.file === "src/a.ts" || item.file === "src/b.ts")).toBe(
      true,
    );
  }, 60_000);

  it("rejects whitespace-only validate_files input deterministically", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const result = await handle.client.callTool({
      name: "validate_files",
      arguments: {
        files: ["   "],
      },
    });

    expect(hasToolError(result)).toBe(true);
    expect(readTextContent(result)).toContain(
      "validate_files requires at least one non-empty file path.",
    );
    expect(
      (readStructuredContent(result)?.error as { code?: string } | undefined)?.code,
    ).toBe("INVALID_INPUT");
  });

  it("rejects validate_files when absolute paths are outside the active root", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-validate-files-outside-parent-");
    const projectRoot = await createValidationProject(tempDir);
    const outsideRootFile = path.join(projectRoot, "..", "outside.ts");

    handle = await createInMemoryTestClient(projectRoot);
    await writeFile(outsideRootFile, "export const outside = 1;\n");

    const result = await handle.client.callTool({
      name: "validate_files",
      arguments: {
        files: [outsideRootFile],
      },
    });

    expect(hasToolError(result)).toBe(true);
    expect(readTextContent(result)).toContain(
      "FeatureType could not choose a project for this file.",
    );
    expect(readTextContent(result)).toContain("not a blocker");
    expect(readTextContent(result)).toContain("attach_project");
    expect(
      (readStructuredContent(result)?.error as { code?: string } | undefined)?.code,
    ).toBe("INVALID_INPUT");
  });

  it("dedupes validate_files entries that resolve to the same file", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-validate-files-dedupe-parent-");
    const projectRoot = await createValidationProject(tempDir);
    const sharedFile = path.join(projectRoot, "src", "a.ts");

    handle = await createInMemoryTestClient(projectRoot);
    await writeFile(sharedFile, "export const first: string = 1;\n");

    const result = await handle.client.callTool({
      name: "validate_files",
      arguments: {
        files: ["src/a.ts", sharedFile],
        severity: "all",
        includeItems: true,
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);
    const items =
      (structured?.items as Array<{ file?: string; fixes?: unknown[] }> | undefined) ?? [];

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("Validated 1 file.");
    expect(Number(structured?.fileCount ?? 0)).toBe(1);
    expect(Number(structured?.totalErrorCount ?? 0)).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]?.file).toBe("src/a.ts");
  }, 60_000);

  it("searches workspace symbols across attached roots without per-root node_modules", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-roots-");
    const alphaRoot = await createTemporaryProject(tempDir, "AlphaSearchSymbol");
    const betaRoot = await createTemporaryProject(tempDir, "BetaSearchSymbol");

    handle = await createInMemoryTestClient(alphaRoot);
    await handle.client.callTool({
      name: "attach_project",
      arguments: {
        projectRoot: betaRoot,
      },
    });

    const result = await handle.client.callTool({
      name: "search_workspace_symbols",
      arguments: {
        query: "SearchSymbol",
        maxResults: 10,
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(text).toContain("AlphaSearchSymbol");
    expect(text).toContain("BetaSearchSymbol");
    expect(text).toContain(alphaRoot);
    expect(text).toContain(betaRoot);
    expect(Number(structured?.totalSymbols ?? 0)).toBe(2);
    expect(structured?.roots).toEqual([betaRoot, alphaRoot]);
  }, 60_000);

  it("lists module exports through completion-based language-server resolution", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-module-exports-");
    const projectRoot = await createPackageResolutionProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "list_module_exports",
      arguments: {
        module: "typescript",
        surface: "all",
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('Exports from "typescript"');
    expect(text).toContain("- addEmitHelper — function ts.addEmitHelper");
    expect(structured?.surface).toBe("all");
    expect(Number(structured?.totalExports ?? 0)).toBeGreaterThan(20);
    expect(Number(structured?.totalMatchingExports ?? 0)).toBe(
      Number(structured?.totalExports ?? 0),
    );
    expect(Number(structured?.hiddenExportCount ?? -1)).toBe(0);
    expect(Number(structured?.offset ?? -1)).toBe(0);
    expect(Number(structured?.pageItemCount ?? 0)).toBeGreaterThan(0);
    expect(Number(structured?.nextOffset ?? 0)).toBe(Number(structured?.pageItemCount ?? 0));
    expect(structured?.exports).toBeUndefined();
  }, 60_000);

  it("narrows and pages module exports progressively", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-module-exports-query-");
    const projectRoot = await createPackageResolutionProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "list_module_exports",
      arguments: {
        module: "typescript",
        query: "create",
        offset: 5,
        maxResults: 5,
        surface: "all",
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('matching "create"');
    expect(text).toContain("\n- ");
    expect(text).toContain("Hint: request offset 10 to continue this query.");
    expect(structured?.surface).toBe("all");
    expect(Number(structured?.totalExports ?? 0)).toBeGreaterThan(
      Number(structured?.totalMatchingExports ?? 0),
    );
    expect(Number(structured?.totalMatchingExports ?? 0)).toBeGreaterThan(
      Number(structured?.pageItemCount ?? 0),
    );
    expect(Number(structured?.hiddenExportCount ?? -1)).toBe(0);
    expect(Number(structured?.offset ?? -1)).toBe(5);
    expect(Number(structured?.nextOffset ?? 0)).toBe(10);
    expect(Number(structured?.pageItemCount ?? -1)).toBe(5);
  }, 60_000);

  it("defaults to runtime-oriented exports and hides type-like symbols", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-module-exports-runtime-");
    const projectRoot = await createMixedExportsProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "list_module_exports",
      arguments: {
        fromFile: "src/consumer.ts",
        module: "./mixed.js",
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("4 runtime exports, 2 type-like hidden");
    expect(text).toContain("- runtimeValue — const runtimeValue: 1");
    expect(text).toContain("- runtimeFunction — function runtimeFunction");
    expect(text).toContain("- RuntimeClass — class RuntimeClass");
    expect(text).toContain("- RuntimeEnum — enum RuntimeEnum");
    expect(text).not.toContain("TypeShape");
    expect(text).not.toContain("TypeAlias");
    expect(structured?.surface).toBe("runtime");
    expect(Number(structured?.totalExports ?? -1)).toBe(6);
    expect(Number(structured?.totalMatchingExports ?? -1)).toBe(4);
    expect(Number(structured?.hiddenExportCount ?? -1)).toBe(2);
    expect(Number(structured?.pageItemCount ?? -1)).toBe(4);
  }, 60_000);

  it("can include type-like exports when surface is all", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-module-exports-all-");
    const projectRoot = await createMixedExportsProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "list_module_exports",
      arguments: {
        fromFile: "src/consumer.ts",
        module: "./mixed.js",
        surface: "all",
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('Exports from "./mixed.js" (6 total, showing 1-6):');
    expect(text).toContain("TypeShape");
    expect(text).toContain("TypeAlias");
    expect(structured?.surface).toBe("all");
    expect(Number(structured?.totalExports ?? -1)).toBe(6);
    expect(Number(structured?.totalMatchingExports ?? -1)).toBe(6);
    expect(Number(structured?.hiddenExportCount ?? -1)).toBe(0);
    expect(Number(structured?.pageItemCount ?? -1)).toBe(6);
  }, 60_000);

  it("explains when only type-like exports match and suggests surface all", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-module-exports-type-query-");
    const projectRoot = await createMixedExportsProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "list_module_exports",
      arguments: {
        fromFile: "src/consumer.ts",
        module: "./mixed.js",
        query: "Type",
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('No runtime exports found for "./mixed.js" matching "Type".');
    expect(text).toContain('retry with surface "all" to include them');
    expect(structured?.surface).toBe("runtime");
    expect(Number(structured?.totalExports ?? -1)).toBe(6);
    expect(Number(structured?.totalMatchingExports ?? -1)).toBe(0);
    expect(Number(structured?.hiddenExportCount ?? -1)).toBe(2);
    expect(Number(structured?.pageItemCount ?? -1)).toBe(0);
  }, 60_000);

  it("clamps oversized export offsets to the last available page boundary", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-module-exports-offset-");
    const projectRoot = await createPackageResolutionProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "list_module_exports",
      arguments: {
        module: "react",
        query: "use",
        maxResults: 5,
        offset: 999,
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("showing 16-19");
    expect(text).toContain("- useRef — function React.useRef");
    expect(text).toContain("- useTransition — function React.useTransition");
    expect(Number(structured?.offset ?? -1)).toBe(15);
    expect(structured?.nextOffset).toBeNull();
    expect(Number(structured?.pageItemCount ?? -1)).toBe(4);
  }, 60_000);

  it("uses nextOffset without overlapping the last page", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-module-exports-next-offset-");
    const projectRoot = await createPackageResolutionProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "list_module_exports",
      arguments: {
        module: "react",
        query: "use",
        maxResults: 10,
        offset: 10,
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("showing 11-19");
    expect(text).toContain("- useInsertionEffect — function React.useInsertionEffect");
    expect(text).toContain("- useTransition — function React.useTransition");
    expect(Number(structured?.offset ?? -1)).toBe(10);
    expect(structured?.nextOffset).toBeNull();
    expect(Number(structured?.pageItemCount ?? -1)).toBe(9);
  }, 60_000);

  it("reports unresolved modules instead of leaking parser keyword completions", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-module-exports-unresolved-");
    const projectRoot = await createPackageResolutionProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "list_module_exports",
      arguments: {
        module: "definitely-not-a-real-package-name-for-featuretype",
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('Could not resolve module "definitely-not-a-real-package-name-for-featuretype"');
    expect(Number(structured?.totalExports ?? -1)).toBe(0);
    expect(Number(structured?.totalMatchingExports ?? -1)).toBe(0);
    expect(Number(structured?.pageItemCount ?? -1)).toBe(0);
    expect(structured?.nextOffset).toBeNull();
    expect(structured?.exports).toBeUndefined();
  }, 60_000);

  it("resolves relative modules from the provided fromFile location", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-module-exports-relative-");
    const projectRoot = await createPackageResolutionProject(tempDir);
    await writeFile(path.join(projectRoot, "src", "consumer.ts"), "export {};\n");

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "list_module_exports",
      arguments: {
        module: "./index.js",
        fromFile: "src/consumer.ts",
        maxResults: 10,
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('Exports from "./index.js"');
    expect(text).not.toContain("\n- keyword type");
    expect(text).toContain("- localValue — const localValue: 1");
    expect(Number(structured?.pageItemCount ?? -1)).toBeGreaterThan(0);
  }, 60_000);

  it("reads TSX files with default code collapsing for practical implementation scans", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-collapsed-file-parent-");
    const projectRoot = await createCollapsedFileProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "read_file",
      arguments: {
        file: "src/view.tsx",
      },
    });

    const text = readTextContent(result);
    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('} from "react";');
    expect(text).toContain(
      "export function DashboardPanel(props: { title: string; values: number[] }) {\n  const stats = useMemo(\n    ... // collapsed stats memo (6 lines)\n  );",
    );
    expect(text).toContain(
      "  return (\n    ... // collapsed return block (7 lines)\n    </section>\n  );\n}",
    );
    expect(text).not.toContain("JSON.stringify(stats, null, 2)");
    expect(readStructuredContent(result)).toBeUndefined();
  }, 60_000);

  it("supports broader practical collapsing passes with imports, comments, and line numbers", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-collapsed-file-parent-");
    const projectRoot = await createCollapsedFileProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "read_file",
      arguments: {
        file: "src/view.tsx",
        kinds: ["code", "imports", "comment"],
        lineNumbers: true,
      },
    });

    const text = readTextContent(result);
    expect(hasToolError(result)).toBe(false);
    expect(text).toContain(" 1 │ import {");
    expect(text).toContain(" 2 │   Suspense,");
    expect(text).toContain(' 4 │ } from "react";');
    expect(text).toContain(" 6 │ /**");
    expect(text).toContain(
      " 7 │  * Build a noisy panel so collapsed-file output can trim implementation detail.",
    );
    expect(text).toContain(" 8 │  */");
    expect(text).toContain(
      " 9 │ export function DashboardPanel(props: { title: string; values: number[] }) {",
    );
    expect(text).toContain("10 │   const stats = useMemo(");
    expect(text).toContain("11 │     ... // collapsed stats memo (6 lines)");
    expect(text).toContain("19 │   return (");
    expect(text).toContain("20 │     ... // collapsed return block (7 lines)");
    expect(text).toContain("27 │     </section>");
    expect(readStructuredContent(result)).toBeUndefined();
  }, 60_000);

  it("keeps grouped imports fully visible even when imports are requested", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-collapsed-file-parent-");
    const projectRoot = await createCollapsedFileProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "read_file",
      arguments: {
        file: "src/imports.ts",
        kinds: ["imports"],
        lineNumbers: true,
      },
    });

    const text = readTextContent(result);
    expect(hasToolError(result)).toBe(false);
    expect(text).toContain(" 1 │ import {");
    expect(text).toContain(" 2 │   Suspense,");
    expect(text).toContain(' 4 │ } from "react";');
    expect(text).toContain(' 5 │ import type { Token } from "./tokens.js";');
    expect(text).toContain(" 6 │ import {");
    expect(text).toContain(" 7 │   readToken,");
    expect(text).toContain(' 9 │ } from "./tokens.js";');
    expect(readStructuredContent(result)).toBeUndefined();
  }, 60_000);

  it("keeps small definitions readable in the default compact read lane", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-collapsed-file-parent-");
    const projectRoot = await createCollapsedFileProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "read_file",
      arguments: {
        file: "src/auth-session.ts",
        lineNumbers: true,
      },
    });

    const text = readTextContent(result);
    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("1 │ export type AuthSession = {");
    expect(text).toContain("2 │   userId: string;");
    expect(text).toContain("3 │   token: string;");
    expect(text).toContain("6 │ export function isAuthenticated(session: AuthSession | null): boolean {");
    expect(text).toContain("7 │   return Boolean(session?.token);");
    expect(text).not.toContain("...");
    expect(readStructuredContent(result)).toBeUndefined();
  }, 60_000);

  it("keeps medium single-body modules raw when collapsing would only produce one blob", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-collapsed-file-parent-");
    const projectRoot = await createCollapsedFileProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "read_file",
      arguments: {
        file: "src/use-auth.ts",
        lineNumbers: true,
      },
    });

    const text = readTextContent(result);
    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("4 │ export function useAuth() {");
    expect(text).toContain("11 │   return {");
    expect(text).toContain("17 │       void router.navigate({ to: \"/signin\" });");
    expect(text).not.toContain("collapsed useAuth body");
    expect(readStructuredContent(result)).toBeUndefined();
  }, 60_000);

  it("keeps larger exported type definitions visible in the default compact read lane", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-collapsed-file-parent-");
    const projectRoot = await createCollapsedFileProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "read_file",
      arguments: {
        file: "src/shapes.ts",
        lineNumbers: true,
      },
    });

    const text = readTextContent(result);
    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("1 │ export interface DashboardSummary {");
    expect(text).toContain("8 │   owner: {");
    expect(text).toContain("14 │ export type DashboardLoadState =");
    expect(text).toContain("17 │   | { status: \"ready\"; summary: DashboardSummary }");
    expect(text).not.toContain("collapsed DashboardSummary definition");
    expect(text).not.toContain("collapsed DashboardLoadState definition");
    expect(readStructuredContent(result)).toBeUndefined();
  }, 60_000);

  it("keeps monolithic page components readable instead of collapsing the whole body", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-collapsed-file-parent-");
    const projectRoot = await createCollapsedFileProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const result = await handle.client.callTool({
      name: "read_file",
      arguments: {
        file: "src/dashboard-page.tsx",
        lineNumbers: true,
      },
    });

    const text = readTextContent(result);
    expect(hasToolError(result)).toBe(false);
    expect(text).toContain(" 3 │ export function DashboardPage() {");
    expect(text).toContain(" 7 │   useEffect(() => {");
    expect(text).toContain(" 8 │     ... // collapsed useEffect callback (7 lines)");
    expect(text).toContain("17 │   const onSelectTopic = useCallback((nextTopic: string | null) => {");
    expect(text).toContain("18 │     setTopic(nextTopic);");
    expect(text).toContain("25 │   const summary = useMemo(() => {");
    expect(text).toContain("26 │     const topicLabel = topic ?? \"all\";");
    expect(text).toContain("33 │   return (");
    expect(text).toContain("34 │     <section>");
    expect(text).not.toContain("... // collapsed DashboardPage body");
    expect(readStructuredContent(result)).toBeUndefined();
  }, 60_000);

  it("attaches nested roots relative to the active project and follows referenced tsconfigs", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-monorepo-parent-");
    const { root, appRoot } = await createTemporaryReferencedMonorepo(tempDir);

    handle = await createInMemoryTestClient(root);
    const attach = await handle.client.callTool({
      name: "attach_project",
      arguments: {
        projectRoot: "apps/web",
      },
    });

    const structured = readStructuredContent(attach);

    expect(structured?.root).toBe(appRoot);
    expect(Number(structured?.fileCount ?? 0)).toBeGreaterThan(0);
  }, 60_000);

  it("routes diagnostics through the most appropriate attached root for nested projects", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-monorepo-parent-");
    const { root, appRoot } = await createTemporaryReferencedMonorepo(tempDir);

    handle = await createInMemoryTestClient(root);
    await handle.client.callTool({
      name: "attach_project",
      arguments: {
        projectRoot: "apps/web",
      },
    });

    const appRelative = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        file: "src/router.ts",
        severity: "all",
        summary: false,
      },
    });
    const monorepoRelative = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        file: "apps/web/src/router.ts",
        severity: "all",
        summary: false,
      },
    });

    expect(readTextContent(appRelative)).toContain("TS2322");
    expect(readTextContent(monorepoRelative)).toContain("TS2322");
    expect(readStructuredContent(appRelative)?.root).toBe(appRoot);
    expect(readStructuredContent(monorepoRelative)?.root).toBe(root);
  }, 60_000);

  it("refreshes attached project file counts after newly created files are added", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-file-count-parent-");
    const projectRoot = await createTemporaryProject(tempDir, "CountSymbol");

    handle = await createInMemoryTestClient(projectRoot);

    const firstAttach = await handle.client.callTool({
      name: "attach_project",
      arguments: {
        projectRoot,
      },
    });

    await writeFile(
      path.join(projectRoot, "src", "extra.ts"),
      "export const extraValue = 1;\n",
    );
    await handle.client.callTool({
      name: "notify_file_changed",
      arguments: {
        file: "src/extra.ts",
      },
    });

    const secondAttach = await handle.client.callTool({
      name: "attach_project",
      arguments: {
        projectRoot,
      },
    });
    const projects = await handle.client.callTool({
      name: "list_projects",
      arguments: {},
    });

    expect(Number(readStructuredContent(firstAttach)?.fileCount ?? 0)).toBe(1);
    expect(Number(readStructuredContent(secondAttach)?.fileCount ?? 0)).toBe(2);
    expect(readStructuredContent(projects)?.projects).toEqual([
      {
        root: projectRoot,
        active: true,
        fileCount: 2,
      },
    ]);
  }, 60_000);

  it("clears stale whole-project diagnostics after creating a missing Bundler import and refreshing", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-bundler-parent-");
    const projectRoot = await createBundlerProjectWithMissingImport(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const beforeDiagnostics = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        summary: true,
      },
    });
    const beforeFixes = await handle.client.callTool({
      name: "find_errors_and_fixes",
      arguments: {},
    });

    await writeFile(
      path.join(projectRoot, "src", "created.ts"),
      'export const createdValue = "ready";\n',
    );
    await handle.client.callTool({
      name: "notify_file_changed",
      arguments: {
        file: "src/created.ts",
      },
    });

    const afterDiagnostics = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        summary: true,
      },
    });
    const afterFixes = await handle.client.callTool({
      name: "find_errors_and_fixes",
      arguments: {},
    });

    expect(Number(readStructuredContent(beforeDiagnostics)?.totalErrorCount ?? 0)).toBe(1);
    expect(readTextContent(beforeDiagnostics)).toContain("src/index.ts");
    expect(Number(readStructuredContent(beforeFixes)?.totalErrorCount ?? 0)).toBe(1);

    expect(Number(readStructuredContent(afterDiagnostics)?.totalErrorCount ?? 0)).toBe(0);
    expect(readTextContent(afterDiagnostics)).toBe("No diagnostics.");
    expect(Number(readStructuredContent(afterFixes)?.totalErrorCount ?? 0)).toBe(0);
    expect(readTextContent(afterFixes)).toBe("No diagnostics found.");
  }, 60_000);

  it("keeps diagnostics working after tsconfig.json changes are refreshed", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-config-refresh-parent-");
    const projectRoot = await createConfigRefreshProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const before = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        summary: true,
      },
    });

    await writeFile(
      path.join(projectRoot, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ES2022",
            strict: true,
          },
          files: ["src/a.ts", "src/b.ts"],
        },
        null,
        2,
      ),
    );
    await handle.client.callTool({
      name: "notify_file_changed",
      arguments: {
        file: "tsconfig.json",
      },
    });

    const after = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        summary: true,
      },
    });

    expect(readTextContent(before)).toBe("No diagnostics.");
    expect(Number(readStructuredContent(after)?.totalErrorCount ?? 0)).toBe(1);
    expect(readTextContent(after)).toContain("src/b.ts");
  }, 60_000);

  it("restores attached roots across fresh runtimes for relative attaches and file routing", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-monorepo-parent-");
    const { root, appRoot } = await createTemporaryReferencedMonorepo(tempDir);

    const firstHandle = await createInMemoryTestClient(root);
    try {
      await firstHandle.client.callTool({
        name: "attach_project",
        arguments: {
          projectRoot: "apps/web",
        },
      });
    } finally {
      await firstHandle.close();
    }

    handle = await createInMemoryTestClient();

    const attach = await handle.client.callTool({
      name: "attach_project",
      arguments: {
        projectRoot: "apps/web",
      },
    });
    const appRelative = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        file: "src/router.ts",
        severity: "all",
        summary: false,
      },
    });
    const monorepoRelative = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        file: "apps/web/src/router.ts",
        severity: "all",
        summary: false,
      },
    });

    expect(readStructuredContent(attach)?.root).toBe(appRoot);
    expect(readStructuredContent(appRelative)?.root).toBe(appRoot);
    expect(readStructuredContent(monorepoRelative)?.root).toBe(root);
    expect(readTextContent(appRelative)).toContain("TS2322");
    expect(readTextContent(monorepoRelative)).toContain("TS2322");
  }, 60_000);

  it("allows file-scoped diagnostics in large attached projects while keeping whole-project scans limited", async () => {
    tempDir = await createRepoTempDir("featuretype-mcp-large-project-parent-");
    const projectRoot = await createLargeDiagnosticProject(tempDir);

    handle = await createInMemoryTestClient(projectRoot);

    const fileScoped = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        file: "src/file-0.ts",
        severity: "all",
        summary: false,
      },
    });
    const wholeProject = await handle.client.callTool({
      name: "get_diagnostics",
      arguments: {
        severity: "all",
        summary: false,
      },
    });

    expect(readTextContent(fileScoped)).toContain("TS2322");
    expect(readStructuredContent(fileScoped)?.limited).toBe(false);
    expect(readStructuredContent(wholeProject)?.limited).toBe(true);
    expect(
      (readStructuredContent(wholeProject)?.error as { code?: string } | undefined)?.code,
    ).toBe("PROJECT_TOO_LARGE");
  }, 60_000);

});
