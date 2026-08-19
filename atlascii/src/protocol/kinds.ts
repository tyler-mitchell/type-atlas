import { type Config, resolve } from "../config/index.ts";
import { translate } from "../config/messages.ts";

export const symbolKind = (kind: number, config?: Config) =>
  translate({ key: `symbol.kind.${kind}`, messages: resolve(config).messages });

export const diagnosticSeverity = (severity: number | undefined, config?: Config) =>
  translate({
    key: severity === undefined ? "diagnostic.severity.unknown" : `diagnostic.severity.${severity}`,
    messages: resolve(config).messages,
  });
