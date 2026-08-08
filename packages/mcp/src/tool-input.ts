import { type } from "arktype";

const sourcePositionInput = type({
  line: type("number.integer >= 1").configure({
    description: "One-based source line.",
  }),
  character: type("number.integer >= 1").configure({
    description: "One-based UTF-16 character.",
  }),
}).onUndeclaredKey("reject");

const toLspPosition = ({ line, character }: typeof sourcePositionInput.infer) => ({
  line: line - 1,
  character: character - 1,
});

export const positionInput = sourcePositionInput.pipe(toLspPosition);

export const positionsInput = sourcePositionInput
  .or(sourcePositionInput.array().atLeastLength(1))
  .pipe((position) =>
    Array.isArray(position) ? position.map(toLspPosition) : toLspPosition(position),
  );

export const rangeInput = type({
  start: positionInput,
  end: positionInput,
}).onUndeclaredKey("reject");

export const fileInput = {
  workspace: type("string >= 1").configure({
    description:
      "Repository root. This selects the language-server session, so use one stable root per repository rather than a subdirectory. Relative paths resolve from the MCP process working directory.",
  }),
  file: type("string >= 1").configure({
    description: "Workspace-relative or absolute file path.",
  }),
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
