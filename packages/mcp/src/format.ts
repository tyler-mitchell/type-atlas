/**
 * Structured diagnostic formatting for agent consumption.
 */

import type * as vscode from "vscode-languageserver-protocol";

export interface FormattedDiagnostic {
  file: string;
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
  severity: "error" | "warning" | "info" | "hint";
  code: string;
  message: string;
  relatedInfo?: Array<{
    file: string;
    line: number;
    col: number;
    message: string;
  }>;
}

const severityMap: Record<number, FormattedDiagnostic["severity"]> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

export function formatDiagnostic(
  d: vscode.Diagnostic,
  filePath: string,
): FormattedDiagnostic {
  return {
    file: filePath,
    line: d.range.start.line + 1,
    col: d.range.start.character + 1,
    endLine: d.range.end.line + 1,
    endCol: d.range.end.character + 1,
    severity: severityMap[d.severity ?? 1] ?? "error",
    code: formatCode(d.code),
    message: d.message,
    relatedInfo: d.relatedInformation?.map((ri) => ({
      file: ri.location.uri,
      line: ri.location.range.start.line + 1,
      col: ri.location.range.start.character + 1,
      message: ri.message,
    })),
  };
}

function formatCode(
  code: vscode.Diagnostic["code"],
): string {
  if (code == null) return "unknown";
  if (typeof code === "number") return `TS${code}`;
  if (typeof code === "string") return code;
  return String(code);
}

export function diagnosticsToXml(
  diagnostics: FormattedDiagnostic[],
  sessionId?: string,
): string {
  const attrs = [
    sessionId ? `session="${sessionId}"` : "",
    `count="${diagnostics.length}"`,
  ]
    .filter(Boolean)
    .join(" ");

  const entries = diagnostics.map((d) => {
    const tag = d.severity === "error" ? "error" : d.severity;
    const fixable = d.relatedInfo ? ' fixable="true"' : "";
    const related = d.relatedInfo
      ?.map(
        (ri) =>
          `    <because file="${ri.file}" line="${ri.line}">${escapeXml(ri.message)}</because>`,
      )
      .join("\n");
    const chain = related ? `\n    <chain>\n${related}\n    </chain>` : "";

    return `  <${tag} file="${d.file}" line="${d.line}" col="${d.col}" code="${d.code}"${fixable}>
    <message>${escapeXml(d.message)}</message>${chain}
  </${tag}>`;
  });

  return `<diagnostic-snapshot ${attrs}>\n${entries.join("\n")}\n</diagnostic-snapshot>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
