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
  workspace: type("string >= 1").describe(
    "Workspace root. Relative paths resolve from the MCP process working directory.",
  ),
  file: type("string >= 1").describe(
    "Workspace-relative or absolute file path.",
  ),
} as const;

export const diagnosticModeInput = type("boolean | 'verbose'").configure({
  default: true,
  description:
    "Include one complete diagnostic plus file totals when present, use 'verbose' for the full report, or false to omit diagnostics.",
});

export const observedFileInput = {
  ...fileInput,
  "includeDiagnostics?": diagnosticModeInput,
} as const;
