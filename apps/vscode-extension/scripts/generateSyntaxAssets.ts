import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function generateSyntaxAssets() {
  const extensionRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const syntaxesDir = path.join(extensionRoot, "syntaxes");

  await mkdir(syntaxesDir, { recursive: true });
  await writeFile(
    path.join(syntaxesDir, "featuretype.tmLanguage.json"),
    `${JSON.stringify(createGrammar(), null, 2)}\n`,
    "utf8",
  );
}

function createGrammar() {
  return {
    $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
    name: "FeatureType",
    scopeName: "source.featuretype",
    fileTypes: ["featuretype"],
    patterns: [
      { include: "#comments" },
      { include: "#fencedTsx" },
      { include: "#fencedTs" },
      { include: "#headings" },
      { include: "#lists" },
    ],
    repository: {
      comments: {
        name: "comment.block.html.featuretype",
        begin: "<!--",
        end: "-->",
        beginCaptures: {
          0: { name: "punctuation.definition.comment.begin.featuretype" },
        },
        endCaptures: {
          0: { name: "punctuation.definition.comment.end.featuretype" },
        },
      },
      headings: {
        patterns: [
          {
            name: "markup.heading.featuretype",
            match: "^(#{1,6})(\\s+)(.+)$",
            captures: {
              1: { name: "punctuation.definition.heading.featuretype" },
              3: { name: "entity.name.section.featuretype" },
            },
          },
        ],
      },
      lists: {
        patterns: [
          {
            name: "markup.list.unnumbered.featuretype",
            match: "^(\\s*)([-+*])(\\s+)",
            captures: {
              2: { name: "punctuation.definition.list.begin.featuretype" },
            },
          },
        ],
      },
      fencedTs: createFenceRule("ts", "source.ts"),
      fencedTsx: createFenceRule("tsx", "source.tsx"),
    },
  };
}

function createFenceRule(language: "ts" | "tsx", contentScope: string) {
  return {
    name: `markup.fenced_code.block.${language}.featuretype`,
    begin: `^([ \\t]*)(\`{3,}|~{3,})(${language})(?=\\s|$)(.*)$`,
    end: "^\\s*\\2\\s*$",
    beginCaptures: {
      2: { name: "punctuation.definition.raw.begin.markdown" },
      3: { name: "fenced_code.block.language.featuretype" },
      4: { name: "meta.fence.info.featuretype" },
    },
    endCaptures: {
      0: { name: "punctuation.definition.raw.end.markdown" },
    },
    contentName: contentScope,
    patterns: [{ include: contentScope }],
  };
}
