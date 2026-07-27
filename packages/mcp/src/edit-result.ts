import { textResult } from "./mcp-result.ts";
import type { renderWorkspaceEdit } from "./workspace-edit.ts";

export const formatPatchResult = (
  label: string,
  result: Awaited<ReturnType<typeof renderWorkspaceEdit>>,
  suffix?: string,
) =>
  result.fileCount
    ? textResult(
        `${label} · ${result.fileCount} ${result.fileCount === 1 ? "file" : "files"} · ${result.editCount} ${result.editCount === 1 ? "edit" : "edits"}\n\n${result.patch}${suffix ? `\n\n${suffix}` : ""}`,
      )
    : textResult("");
