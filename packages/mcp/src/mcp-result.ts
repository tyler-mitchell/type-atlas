import type { CallToolResult } from "@modelcontextprotocol/server";

export const textResult = (text: string): CallToolResult => ({
  content: text ? [{ type: "text", text }] : [],
});

/**
 * Rewrites the first or last text block. A result with none — an elicitation,
 * an empty answer — comes back untouched.
 */
export const editText = <Result extends object>(
  result: Result,
  at: "first" | "last",
  edit: (text: string) => string,
): Result => {
  const content = (result as { readonly content?: readonly { type: string; text?: string }[] })
    .content;
  if (!content?.length) return result;
  const index = at === "first" ? 0 : content.length - 1;
  const block = content[index];
  if (block?.type !== "text") return result;
  return { ...result, content: content.with(index, { ...block, text: edit(block.text ?? "") }) };
};

/** An answer — text, or an already-built result — with any ambient diagnostics after it. */
export const appendDiagnosticContext = async (
  answer: CallToolResult | string,
  context: string | undefined | Promise<string | undefined>,
): Promise<CallToolResult> => {
  const result = typeof answer === "string" ? textResult(answer) : answer;
  const diagnostics = await context;
  if (!diagnostics) return result;
  if (result.content.at(-1)?.type === "text") {
    return editText(result, "last", (text) => `${text}\n\n${diagnostics}`);
  }
  return { ...result, content: [...result.content, { type: "text", text: diagnostics }] };
};
