import { type } from "arktype";

export const positionInput = type({
  line: type("number.integer >= 0").describe("Zero-based source line."),
  character: type("number.integer >= 0").describe(
    "Zero-based UTF-16 character.",
  ),
}).onUndeclaredKey("reject");

export const rangeInput = type({
  start: positionInput,
  end: positionInput,
}).onUndeclaredKey("reject");

export const fileInput = {
  workspace: type("string >= 1").describe("Absolute workspace root."),
  file: type("string >= 1").describe(
    "Workspace-relative or absolute file path.",
  ),
} as const;

export const observedFileInput = {
  ...fileInput,
  includeDiagnostics: type("boolean")
    .describe("Include actionable diagnostics from the queried file when present.")
    .default(true),
} as const;
