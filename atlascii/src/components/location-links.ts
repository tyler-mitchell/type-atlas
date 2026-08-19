import { type Config, resolve } from "../config/index.ts";
import { translate } from "../config/messages.ts";
import type { LocationLink, StackFrame } from "../protocol/shapes.ts";
import { rangeText, sameRange } from "../protocol/range.ts";

export const locationLinks = (input: {
  readonly items: readonly LocationLink[];
  readonly config?: Config;
}): readonly string[] => {
  const { marks, messages, figures } = resolve(input.config);
  const extent = translate({ key: "range.extent", messages });
  return input.items.map(
    (item) =>
      `${figures.pointer} ${item.name ? `${item.name}${marks.separator}` : ""}${item.file}:${rangeText(
        item.selection,
      )}${
        item.range && !sameRange(item.range, item.selection)
          ? `${marks.separator}${extent} ${rangeText(item.range)}`
          : ""
      }`,
  );
};

export const frames = (input: {
  readonly stack: readonly StackFrame[];
  readonly config?: Config;
}): readonly string[] => {
  const { figures } = resolve(input.config);
  return input.stack.map((entry) =>
    [figures.pointer, entry.name, `${entry.file}:${entry.line}:${entry.character}`]
      .filter(Boolean)
      .join(" "),
  );
};
