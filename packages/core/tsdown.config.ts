import { defineConfig } from "tsdown";
import shared from "../../tsdown.config.ts";

/**
 * The authored documents are assets, and a bundle does not carry them.
 *
 * `render.ts` reads a document from beside itself — `join(here, "documents",
 * name)` — which resolves to `src/markdoc/documents` from source and to
 * `dist/documents` from the built package. Only the first of those existed, so
 * every tool in the published package answered `ENOENT` for its own document
 * while the whole surface passed from source, which is where it was always
 * exercised.
 *
 * Copied rather than inlined because they are what they look like: authored
 * files, read once and cached, that a consumer can open and read. Inlining them
 * into the bundle would make the design artifact invisible in the thing that
 * ships.
 */
export default defineConfig({
  ...shared,
  // `to` names the parent the directory lands in, not the directory itself:
  // `to: "dist/documents"` produced `dist/documents/documents`.
  copy: [
    { from: "src/markdoc/documents", to: "dist" },
    { from: "src/markdoc/partials", to: "dist" },
  ],
});
