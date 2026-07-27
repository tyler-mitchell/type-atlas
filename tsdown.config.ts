import { defineConfig } from "tsdown";

export default defineConfig({
  attw: {
    level: "error",
    profile: "esm-only",
  },
  dts: true,
  fixedExtension: false,
  format: "esm",
  publint: true,
  sourcemap: true,
});
