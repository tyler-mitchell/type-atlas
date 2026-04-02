import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestClient,
  createStdioTestClient,
  demoWorkspaceRoot,
  readStructuredContent,
  readTextContent,
  runBasicProbe,
  type TestClientHandle,
} from "./testing.js";

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

describe("featuretype MCP local probes", () => {
  let handle: TestClientHandle | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("supports in-memory MCP probing without Codex or stdio", async () => {
    handle = await createInMemoryTestClient(demoWorkspaceRoot);
    await expectBasicProbe(handle);
  });

  it("supports stdio MCP probing without rebinding Codex", async () => {
    handle = await createStdioTestClient(demoWorkspaceRoot);
    await expectBasicProbe(handle);
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
    tempDir = await mkdtemp(path.join(os.tmpdir(), "featuretype-mcp-roots-"));
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
  });

});
