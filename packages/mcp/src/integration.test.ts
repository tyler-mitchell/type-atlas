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
        line: 1,
        code: "TSmissing-required-block",
        fixes: [
          {
            title: "Add <intent> block",
            kind: "quickfix",
          },
        ],
      },
      {
        line: 9,
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
      "[error] 1:1  TSmissing-required-block  FeatureType documents must declare an <intent> block.",
    );
    expect(compactText).toContain("    fix: Add <intent> block");
    expect(compactText).toContain(
      "[error] 9:14  TS2322  Type '\"destructive\"' is not assignable to type '\"primary\" | \"danger\" | undefined'.",
    );
    expect(compactText).not.toContain(
      "TS2322  Type '\"destructive\"' is not assignable to type '\"primary\" | \"danger\" | undefined'.\n    fix: Add <intent> block",
    );
    expect(items).toMatchObject([
      {
        line: 1,
        code: "TSmissing-required-block",
        fixes: [{ title: "Add <intent> block" }],
      },
      {
        line: 9,
        code: "TS2322",
        fixes: [],
      },
    ]);
  });

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
      "validate_files requires all files to resolve under the same attached root.",
    );
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
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);
    const exports =
      (structured?.exports as Array<{ name?: string; documentation?: string }> | undefined) ?? [];

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('Exports from "typescript"');
    expect(Number(structured?.totalExports ?? 0)).toBeGreaterThan(20);
    expect(exports.length).toBeLessThan(Number(structured?.totalExports ?? 0));
    expect(Number(structured?.totalMatchingExports ?? 0)).toBe(
      Number(structured?.totalExports ?? 0),
    );
    expect(Number(structured?.offset ?? -1)).toBe(0);
    expect(Number(structured?.nextOffset ?? 0)).toBe(exports.length);
    expect(exports.some((entry) => entry.name === "addEmitHelper")).toBe(true);
    expect(
      exports.some(
        (entry) =>
          typeof entry.documentation === "string" && entry.documentation.length > 0,
      ),
    ).toBe(true);
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
      },
    });

    const text = readTextContent(result);
    const structured = readStructuredContent(result);
    const exports =
      (structured?.exports as Array<{ name?: string }> | undefined) ?? [];

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('matching "create"');
    expect(Number(structured?.totalExports ?? 0)).toBeGreaterThan(
      Number(structured?.totalMatchingExports ?? 0),
    );
    expect(Number(structured?.totalMatchingExports ?? 0)).toBeGreaterThan(exports.length);
    expect(Number(structured?.offset ?? -1)).toBe(5);
    expect(Number(structured?.nextOffset ?? 0)).toBe(10);
    expect(exports).toHaveLength(5);
    expect(
      exports.every((entry) => entry.name?.toLowerCase().startsWith("create") ?? false),
    ).toBe(true);
  }, 60_000);

  it("clamps oversized export offsets to the last full page", async () => {
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
    const exports =
      (structured?.exports as Array<{ name?: string }> | undefined) ?? [];

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain("showing 15-19");
    expect(Number(structured?.offset ?? -1)).toBe(14);
    expect(structured?.nextOffset).toBeNull();
    expect(exports).toHaveLength(5);
    expect(exports.at(-1)?.name).toBe("useTransition");
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
    expect(structured?.nextOffset).toBeNull();
    expect(structured?.exports).toEqual([]);
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
    const exports =
      (structured?.exports as Array<{ name?: string }> | undefined) ?? [];

    expect(hasToolError(result)).toBe(false);
    expect(text).toContain('Exports from "./index.js"');
    expect(exports.some((entry) => entry.name === "localValue")).toBe(true);
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
