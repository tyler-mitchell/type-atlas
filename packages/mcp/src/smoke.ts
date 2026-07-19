import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createInMemoryTestClient,
  createStdioTestClient,
  demoWorkspaceRoot,
  runBasicProbe,
  readStructuredContent,
  type TestClientHandle,
} from "./testing.js";

type TransportMode = "in-memory" | "stdio";

function parseArgs(argv: string[]): {
  transport: TransportMode;
  projectRoot: string;
} {
  const transportArg = argv.find((arg) => arg.startsWith("--transport="));
  const transport = transportArg?.split("=")[1] === "in-memory"
    ? "in-memory"
    : "stdio";
  const positionalArg = argv.find((arg) => !arg.startsWith("--"));

  return {
    transport,
    projectRoot: path.resolve(positionalArg ?? demoWorkspaceRoot),
  };
}

async function main() {
  const { transport, projectRoot } = parseArgs(process.argv.slice(2));
  let handle: TestClientHandle | undefined;
  const editProbeFile = `.featuretype-mcp-edit-probe-${process.pid}.ts`;
  const editProbePath = path.join(projectRoot, editProbeFile);

  try {
    handle =
      transport === "in-memory"
        ? await createInMemoryTestClient(projectRoot)
        : await createStdioTestClient(projectRoot);

    const probe = await runBasicProbe(handle.client);
    await writeFile(editProbePath, "export const probe = 1;\n");
    const editProbe = await handle.client.callTool({
      name: "edit_workspace",
      arguments: {
        operations: [{
          kind: "replace",
          file: editProbeFile,
          oldText: "probe = 1",
          newText: "probe = 2",
        }],
      },
    });
    const editStatus = readStructuredContent(editProbe)?.status;
    const editApplied = editStatus === "applied"
      && (await readFile(editProbePath, "utf8")).includes("probe = 2");
    console.log(
      JSON.stringify(
        {
          ok: editApplied,
          transport,
          projectRoot,
          editStatus,
          editApplied,
          ...probe,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(editProbePath, { force: true }).catch(() => undefined);
    await handle?.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
