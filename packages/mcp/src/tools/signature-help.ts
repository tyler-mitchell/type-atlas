import type { SignatureHelp } from "vscode-languageserver-protocol";

export function formatSignatureHelp(help: SignatureHelp): string {
  const lines: string[] = [];

  for (const signature of help.signatures) {
    lines.push(signature.label);

    if (signature.documentation) {
      lines.push(
        typeof signature.documentation === "string"
          ? signature.documentation
          : signature.documentation.value,
      );
    }

    if (!signature.parameters) {
      continue;
    }

    for (const parameter of signature.parameters) {
      const label =
        typeof parameter.label === "string"
          ? parameter.label
          : signature.label.slice(parameter.label[0], parameter.label[1]);
      const documentation = parameter.documentation
        ? typeof parameter.documentation === "string"
          ? parameter.documentation
          : parameter.documentation.value
        : "";

      lines.push(`  ${label}${documentation ? ` — ${documentation}` : ""}`);
    }
  }

  return lines.join("\n");
}
