process.env.FEATURETYPE_RUNTIME_MODE ??= "source";

const { runCli } = await import("./cli.js");

await runCli();
