import { type } from "arktype";

const sourcePositionInput = type({
  line: type("number.integer >= 1").configure({
    description: "One-based source line.",
  }),
  character: type("number.integer >= 1").configure({
    description: "One-based UTF-16 character.",
  }),
});

const toLspPosition = ({ line, character }: typeof sourcePositionInput.infer) => ({
  line: line - 1,
  character: character - 1,
});

export const positionInput = sourcePositionInput
  .pipe(toLspPosition)
  .describe(
    "Source position to inspect, as { line, character }. Both are one-based, matching what an editor displays. Point at the symbol name itself, not the line start.",
  );

export const positionsInput = sourcePositionInput
  .array()
  .atLeastLength(1)
  .pipe((positions) => positions.map(toLspPosition))
  .describe(
    "One or more source positions to inspect together, each a one-based { line, character }.",
  );

export const rangeInput = type({
  start: positionInput,
  end: positionInput,
}).describe(
  "Source range as { start, end }, each a one-based { line, character }. Use a zero-length range (start equal to end) to act at a cursor.",
);

export const fileInput = {
  workspace: type("string >= 1").configure({
    description:
      "Repository root. This selects the language-server session, so use one stable root per repository rather than a subdirectory. Relative paths resolve from the MCP process working directory.",
  }),
  file: type("string >= 1").configure({
    description: "Workspace-relative or absolute file path.",
  }),
} as const;

export const diagnosticModeInput = type("'summary' | 'verbose' | 'off'").configure(
  {
    default: "summary",
    description:
      "One of: summary (one complete diagnostic plus file totals), verbose (the full report), off (omit diagnostics).",
  },
  "self",
);

export const observedFileInput = {
  ...fileInput,
  "includeDiagnostics?": diagnosticModeInput,
} as const;

/**
 * Shared paging vocabulary for tools that return a bounded slice of a larger
 * result set, so the same three parameters mean the same thing everywhere.
 */
export const paginationInput = {
  "offset?": type("number.integer >= 0").configure({
    description: "Number of leading results to skip before this page.",
  }),
  "limit?": type("1 <= number.integer <= 100").configure({
    description: "Maximum results returned in this page.",
  }),
  "raw?": type("boolean").configure({
    description:
      "Return every result instead of one page. Potentially very large in a monorepo; prefer paging.",
  }),
} as const;
