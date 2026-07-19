import type { CallToolResult } from "@modelcontextprotocol/server";

export const textResult = (text: string): CallToolResult => ({
  content: text ? [{ type: "text", text }] : [],
});

export const appendDiagnosticContext = (
  result: CallToolResult,
  context: string | undefined,
): CallToolResult =>
  context
    ? {
      ...result,
      content: [
        ...result.content,
        { type: "text", text: `\n\n${context}` },
      ],
    }
    : result;
