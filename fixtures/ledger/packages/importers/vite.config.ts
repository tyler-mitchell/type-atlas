// Importers ship to the bookkeeping portal as a browser bundle; the library
// packages stay unbundled. Output lands in the default `dist` beside this
// config, which the repository commits so the portal deploy needs no build.
export default {
  build: {
    outDir: "dist",
    lib: { entry: "src/index.ts", formats: ["es"] },
  },
};
