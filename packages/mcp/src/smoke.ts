import path from "node:path";
import {
  createInMemoryTestClient,
  createStdioTestClient,
  demoWorkspaceRoot,
  runBasicProbe,
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

  try {
    handle =
      transport === "in-memory"
        ? await createInMemoryTestClient(projectRoot)
        : await createStdioTestClient(projectRoot);

    const probe = await runBasicProbe(handle.client);
    console.log(
      JSON.stringify(
        {
          ok: true,
          transport,
          projectRoot,
          ...probe,
        },
        null,
        2,
      ),
    );
  } finally {
    await handle?.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
