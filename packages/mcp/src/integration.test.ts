import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

describe("featuretype MCP local probes", () => {
  let handle: TestClientHandle | undefined;
  let tempDir: string | undefined;

  beforeAll(() => {
    process.env.FEATURETYPE_RUNTIME_MODE = "source";
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  afterAll(() => {
    if (previousRuntimeMode === undefined) {
      delete process.env.FEATURETYPE_RUNTIME_MODE;
      return;
    }
    process.env.FEATURETYPE_RUNTIME_MODE = previousRuntimeMode;
  });

  it("supports in-memory MCP probing without Codex or stdio", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);
    await expectBasicProbe(handle);
  });

  it("supports stdio MCP probing without rebinding Codex", async () => {
    handle = await createStdioTestClient(demoWorkspaceRoot);
    await expectBasicProbe(handle);
  });

  it("keeps find_errors_and_fixes items in structured output by default", async () => {
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
    const items =
      (structured?.items as Array<{ fixes?: unknown[] }> | undefined) ?? [];

    expect(text).toContain("broken-button.featuretype");
    expect(Number(structured?.totalCount ?? 0)).toBeGreaterThan(0);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => (item.fixes?.length ?? 0) > 0)).toBe(true);
  });

  it("omits structured fix items when explicitly disabled", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);

    const result = await handle.client.callTool({
      name: "find_errors_and_fixes",
      arguments: {
        file: "broken-button.featuretype",
        severity: "all",
        includeItems: false,
      },
    });

    expect(readStructuredContent(result)?.items).toBeUndefined();
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

});
