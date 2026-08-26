import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import type { NapiConfig, SgNode } from "@ast-grep/napi";
import * as path from "pathe";

const identifierKinds = [
  "identifier",
  "private_property_identifier",
  "property_identifier",
  "shorthand_property_identifier_pattern",
] as const;

const identifierMatcher: NapiConfig = {
  rule: { any: identifierKinds.map((kind) => ({ kind })) },
};

type CandidatePosition = {
  readonly file: string;
  readonly position: { readonly line: number; readonly character: number };
};

export type OccurrenceCandidate = {
  readonly query: string;
  readonly kind: "identifier" | "expression";
  readonly anchor: string;
  readonly files: ReadonlySet<string>;
  readonly total: number;
  readonly positions: readonly CandidatePosition[];
};

export const findOccurrenceCandidates = async (input: {
  readonly root: string;
  readonly queries: readonly string[];
  readonly files: readonly string[];
  readonly signal: AbortSignal;
}): Promise<readonly OccurrenceCandidate[]> => {
  const { Lang, parse, pattern } = await import("@ast-grep/napi");
  const queryIndexes = new Map(input.queries.map((query, index) => [query, index]));
  const definitions = input.queries.map((query) => {
    const identifier = parse(Lang.TypeScript, query).root().find(identifierMatcher);
    return {
      query,
      anchor: identifier?.text() ?? query,
      kind: identifier?.text() === query ? ("identifier" as const) : ("expression" as const),
    };
  });
  const languages = [
    { lang: Lang.TypeScript, extensions: new Set([".ts", ".mts", ".cts"]) },
    { lang: Lang.Tsx, extensions: new Set([".tsx", ".jsx"]) },
    { lang: Lang.JavaScript, extensions: new Set([".js", ".mjs", ".cjs"]) },
  ].map(({ lang, extensions }) => ({
    lang,
    extensions,
    matchers: definitions.map((definition) =>
      definition.kind === "expression" ? pattern(lang, definition.query) : undefined,
    ),
  }));
  const found = input.queries.map(() => ({
    files: new Set<string>(),
    positions: [] as CandidatePosition[],
    seen: new Set<string>(),
  }));
  const record = (match: {
    readonly index: number;
    readonly file: string;
    readonly lines: readonly string[];
    readonly node: SgNode;
  }): void => {
    const { index, file, lines, node } = match;
    const start = node.range().start;
    const line = lines[start.line] ?? "";
    const character = Buffer.from(line).subarray(0, start.column).toString().length;
    const identity = `${file}:${start.line}:${character}`;
    if (found[index]!.seen.has(identity)) return;
    found[index]!.seen.add(identity);
    found[index]!.files.add(file);
    found[index]!.positions.push({ file, position: { line: start.line, character } });
  };
  const sources = await Promise.all(
    input.files.map(async (file) => ({
      file: path.relative(input.root, file),
      source: await readFile(file, { encoding: "utf8", signal: input.signal }),
    })),
  );
  for (const { file, source } of sources) {
    input.signal.throwIfAborted();
    const language = languages.find(({ extensions }) => extensions.has(path.extname(file)));
    if (!language) continue;
    const tree = parse(language.lang, source).root();
    const lines = source.split("\n");
    for (const node of tree.findAll(identifierMatcher)) {
      const index = queryIndexes.get(node.text());
      if (index !== undefined) record({ index, file, lines, node });
    }
    for (const [index, matcher] of language.matchers.entries()) {
      if (!matcher) continue;
      for (const node of tree.findAll(matcher)) {
        record({ index, file, lines, node: node.find(identifierMatcher) ?? node });
      }
    }
  }

  return definitions.map((definition, index) => ({
    ...definition,
    files: found[index]!.files,
    total: found[index]!.positions.length,
    positions: found[index]!.positions.toSorted(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.position.line - right.position.line ||
        left.position.character - right.position.character,
    ),
  }));
};
