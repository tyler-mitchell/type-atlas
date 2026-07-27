import type { CallToolResult } from "@modelcontextprotocol/server";

export const textResult = (text: string): CallToolResult => ({
  content: text ? [{ type: "text", text }] : [],
});

export const appendDiagnosticContext = (
  result: CallToolResult,
  context: string | undefined,
): CallToolResult => {
  if (!context) return result;
  const last = result.content.at(-1);
  return {
    ...result,
    content:
      last?.type === "text"
        ? [...result.content.slice(0, -1), { ...last, text: `${last.text}\n\n${context}` }]
        : [...result.content, { type: "text", text: context }],
  };
};
