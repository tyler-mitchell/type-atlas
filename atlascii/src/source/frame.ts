import { stripVTControlCharacters } from "node:util";
import { type Config, resolve } from "../config/index.ts";
import { lineSplit, newlineWidth, positionToOffset } from "./offsets.ts";
import { truncateString as truncate } from "./truncate.ts";
import { width } from "../text/width.ts";

const truncateString = (value: string, maxLength: number): string =>
  truncate(stripVTControlCharacters(value), maxLength);

export const codeFrame = (input: {
  readonly source: string;
  readonly line: number;
  readonly character: number;
  readonly end?: { readonly line: number; readonly character: number };
  readonly range?: number;
  readonly indent?: number;
  readonly config?: Config;
}): string => {
  const { marks, dimensions } = resolve(input.config);
  const source = input.source;
  const indent = input.indent ?? 0;
  const range = input.range ?? dimensions.frameContext;
  const start = positionToOffset({ source, line: input.line, character: input.character });
  const end = input.end
    ? positionToOffset({ source, line: input.end.line, character: input.end.character })
    : start;
  const lines = source.split(lineSplit);
  const nl = newlineWidth(source);
  let count = 0;
  let res: string[] = [];

  const columns = dimensions.ruleWidth;
  const lineNo = (no: number | string = "") =>
    `${String(no).padStart(dimensions.gutterWidth, " ")} ${marks.gutter}`;

  for (let i = 0; i < lines.length; i += 1) {
    count += (lines[i] ?? "").length + nl;
    if (count >= start) {
      for (let j = i - range; j <= i + range || end > count; j += 1) {
        if (j < 0 || j >= lines.length) {
          continue;
        }

        const lineLength = (lines[j] ?? "").length;
        const strippedContent = stripVTControlCharacters(lines[j] ?? "");

        if (strippedContent.startsWith("//# sourceMappingURL")) {
          continue;
        }

        if (strippedContent.length > dimensions.maximumLineLength) {
          return "";
        }

        const truncatedLine = truncateString(
          (lines[j] ?? "").replace(/\t/g, " "),
          columns - dimensions.gutterWidth - 2 - indent,
        ).trimEnd();
        res.push(
          lineNo(j + 1) + (truncatedLine ? " " + truncatedLine : truncatedLine),
        );

        if (j === i) {
          const pad = start - (count - lineLength) + (nl - 1);
          const length = Math.max(
            1,
            end > count ? lineLength - pad : end - start,
          );
          // Columns, not code units. A position is reported in units and the
          // frame is read in columns, and the two only agree while the line is
          // narrow: `const 名前 = "太郎"; const wideProbe` puts `wideProbe` at
          // unit 24 and column 28, so counting units drew the caret four
          // columns short of the name it was pointing at. Vitest never meets
          // this — it frames a point in its own ASCII sources.
          const shown = (lines[j] ?? "").replace(/\t/g, " ");
          res.push(
            lineNo() +
              " ".repeat(width(shown.slice(0, pad)) + 1) +
              marks.caret.repeat(width(shown.slice(pad, pad + length)) || 1),
          );
        } else if (j > i) {
          if (end > count) {
            const length = Math.max(1, Math.min(end - count, lineLength));
            const shown = (lines[j] ?? "").replace(/\t/g, " ");
            res.push(lineNo() + " " + marks.caret.repeat(width(shown.slice(0, length)) || 1));
          }
          count += lineLength + 1;
        }
      }
      break;
    }
  }

  if (indent) {
    res = res.map((line) => " ".repeat(indent) + line);
  }

  return res.join("\n");
};
