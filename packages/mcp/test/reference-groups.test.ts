import { expect, test } from "vitest";
import { referenceGroups } from "../src/reference-groups.ts";

const site = (file: string, line: number, character: number, within?: string) => ({
  file,
  line,
  character,
  within,
});

test("puts the path on the line when no file holds more than one use", () => {
  // Grouping costs a header line and a connector per file. A file holding one
  // use spends both to say what fits on one line, and a list of single hits
  // across many files is all header and no content.
  expect(
    referenceGroups([site("src/app.ts", 10, 3, "open"), site("src/index.ts", 4, 1)]),
  ).toEqual([
    { file: "src/app.ts", at: "10:3", within: "open" },
    { file: "src/index.ts", at: "4:1", within: undefined },
  ]);
});

test("makes the path a level as soon as one file repeats", () => {
  // Thirteen uses in one module printed the same forty characters thirteen
  // times. One file earning it is enough, because a mixed answer that grouped
  // some files and not others would read as two different answers.
  const grouped = referenceGroups([
    site("src/app.ts", 10, 3, "open"),
    site("src/app.ts", 120, 30),
    site("src/index.ts", 4, 1),
  ]);
  expect(grouped).toEqual([
    {
      file: "src/app.ts",
      children: [
        { at: "10:3", column: 6, within: "open" },
        { at: "120:30", column: 6, within: undefined },
      ],
    },
    { file: "src/index.ts", children: [{ at: "4:1", column: 3, within: undefined }] },
  ]);
});

test("states a column only where there is one to hold to", () => {
  // Positions differ in width — `483:8` against `187:27` — so a group states
  // the widest of its own and the document pads every position to it. Under a
  // flat list each line begins with a different path, so there is no column,
  // and carrying one would align nothing.
  const [flat] = referenceGroups([site("src/app.ts", 10, 3)]);
  expect(flat).not.toHaveProperty("column");
  const [group] = referenceGroups([site("src/app.ts", 10, 3), site("src/app.ts", 1200, 30)]);
  expect(group).toEqual({
    file: "src/app.ts",
    children: [
      { at: "10:3", column: 7, within: undefined },
      { at: "1200:30", column: 7, within: undefined },
    ],
  });
});
