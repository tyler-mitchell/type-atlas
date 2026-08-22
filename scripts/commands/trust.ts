import { defineCommand } from "citty";
import { execa } from "execa";

/**
 * Gives one package a GitHub Actions trusted publisher on npm.
 *
 * Trusted publishing is configured per package, not per repository, so a
 * package added to the suite after the first setup has no credential until
 * this runs — which is how 0.4.0 published three packages and left `atlascii`
 * behind with an `E404`. The name need not exist on npm yet; npm accepts the
 * configuration and asks only for an authenticated session with 2FA.
 *
 * npm's own CLI under a supported Node, because the bundled one is older than
 * the `trust` subcommand.
 */
export default defineCommand({
  meta: {
    name: "trust",
    description: "Configure a package's GitHub Actions trusted publisher on npm.",
  },
  args: {
    package: {
      type: "positional",
      description: "Package name as npm knows it, such as atlascii or @type-atlas/mcp.",
    },
  },
  run: async ({ args }) =>
    void (await execa(
      "npx",
      [
        "--yes",
        "--package=node@24",
        "--package=npm@latest",
        "-c",
        `npm trust github ${args.package} --file release.yml --repository tyler-mitchell/type-atlas --allow-publish --yes`,
      ],
      { stdio: "inherit" },
    )),
});
