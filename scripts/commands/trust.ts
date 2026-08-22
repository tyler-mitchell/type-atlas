import { execa } from "execa";

export const trustPublisher = async (packageName: string): Promise<void> =>
  void (await execa(
    "npx",
    [
      "--yes",
      "--package=node@24",
      "--package=npm@latest",
      "-c",
      `npm trust github ${packageName} --file release.yml --repository tyler-mitchell/type-atlas --allow-publish --yes`,
    ],
    { stdio: "inherit" },
  ));
