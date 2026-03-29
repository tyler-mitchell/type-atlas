import { context } from "esbuild";

const watchMode = process.argv.includes("--watch");
const minify = process.argv.includes("--minify");

async function main() {
  const buildContext = await context({
    entryPoints: {
      extension: "./src/extension.ts",
      server: "../../packages/language-server/src/index.ts",
    },
    bundle: true,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    external: ["vscode"],
    format: "cjs",
    minify,
    outdir: "./dist",
    platform: "node",
    sourcemap: true,
    target: "node18",
    tsconfig: "./tsconfig.json",
  });

  if (watchMode) {
    await buildContext.watch();
    console.log("watching...");
    return;
  }

  await buildContext.rebuild();
  await buildContext.dispose();
  console.log("finished.");
}

void main();
