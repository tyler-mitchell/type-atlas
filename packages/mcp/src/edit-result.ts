import { renderDocument } from "@type-atlas/core";
import { textResult } from "./mcp-result.ts";
import type { renderWorkspaceEdit } from "./workspace-edit.ts";

/**
 * A patch under what produced it.
 *
 * `title` is the caller's own name for the change — a language server's action
 * title, or the verb a tool is named for. Everything counted or joined around
 * it belongs to the document, so no tool decides how a file is pluralised.
 */
export const formatPatchResult = async (
  title: string,
  result: Awaited<ReturnType<typeof renderWorkspaceEdit>>,
  extra?: {
    readonly scope?: { readonly kind: "project" | "loaded" | "file"; readonly anchor?: string };
    readonly note?: string;
    /**
     * What the position resolved to — the fact that lets a reader catch a
     * mistargeted change from the first line instead of from the edits.
     */
    readonly subject?: {
      readonly name?: string;
      readonly file: string;
      readonly at?: { readonly line: number; readonly character: number };
    };
    /** The subject is an installed dependency's — the patch is refused. */
    readonly foreign?: boolean;
    /** The provider returned no edit at all, as opposed to an empty one. */
    readonly unanswered?: boolean;
  },
) => {
  // An empty result renders the document's own "No edits" sentence — this
  // used to return "", and format_document on an already-formatted file
  // answered with nothing at all, the blank the design language forbids.
  const rendered = await renderDocument({
    document: "patch.tool.mdoc",
    variables: {
      title,
      subject: extra?.subject,
      foreign: extra?.foreign ?? false,
      unanswered: extra?.unanswered ?? false,
      scope: extra?.scope,
      fileCount: result.fileCount,
      editCount: result.editCount,
      patch: result.patch,
      note: extra?.note,
    },
  });
  return textResult(rendered.text);
};
