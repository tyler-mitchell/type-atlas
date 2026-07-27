import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { isFileInDir } from "@volar/language-server/node.js";
import * as path from "pathe";

const execFileAsync = promisify(execFile);

export const findGitSubmoduleRoots = async (workspaceRoot: string): Promise<readonly string[]> => {
  const config = path.join(workspaceRoot, ".gitmodules");
  if (!(await stat(config).catch(() => undefined))?.isFile()) return [];

  const { stdout } = await execFileAsync("git", ["config", "--null", "--file", config, "--list"], {
    encoding: "utf8",
  });

  return stdout
    .split("\0")
    .filter(Boolean)
    .filter((entry) => /^submodule\..+\.path\n/.test(entry))
    .map((entry) => {
      const root = path.resolve(workspaceRoot, entry.slice(entry.indexOf("\n") + 1));
      if (root === workspaceRoot || !isFileInDir(root, workspaceRoot)) {
        throw new Error(`Git submodule is outside the workspace: ${root}`);
      }
      return root;
    });
};

export const containingGitSubmodule = (
  file: string,
  submoduleRoots: readonly string[],
): string | undefined => submoduleRoots.find((root) => file === root || isFileInDir(file, root));
