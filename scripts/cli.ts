import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: { name: "type-atlas", description: "Type Atlas product automation." },
  subCommands: {
    "dev-stop": () =>
      import("./commands/stop-dev-servers.ts").then(({ default: command }) => command),
    "registry-prepare": () =>
      import("./commands/prepare-registry-manifest.ts").then(({ default: command }) => command),
    "registry-publish": () =>
      import("./commands/publish-registry.ts").then(({ default: command }) => command),
    "release-verify": () =>
      import("./commands/verify-published.ts").then(({ default: command }) => command),
  },
});

await runMain(main);
