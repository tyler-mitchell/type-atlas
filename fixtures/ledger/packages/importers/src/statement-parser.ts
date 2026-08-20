import { parseStatement, type StatementRow } from "./csv.ts";

/**
 * One bank format, parsed. Concrete parsers own the format quirks; consumers
 * hold the abstraction and pick a parser by the file they were handed.
 */
export abstract class StatementParser {
  abstract readonly format: string;

  /** Whether this parser recognises the file. Cheap — a sniff, not a parse. */
  abstract recognises(source: string): boolean;

  abstract parse(source: string): readonly StatementRow[];

  /** Parse one source, or several concatenated exports in one pass. */
  parseAll(source: string): readonly StatementRow[];
  parseAll(sources: readonly string[]): readonly StatementRow[];
  parseAll(sources: string | readonly string[]): readonly StatementRow[] {
    return (typeof sources === "string" ? [sources] : sources).flatMap((source) =>
      this.parse(source),
    );
  }
}

export class CsvStatementParser extends StatementParser {
  readonly format = "csv";

  recognises(source: string): boolean {
    return source.trimStart().startsWith("date,description,amount,currency");
  }

  parse(source: string): readonly StatementRow[] {
    return parseStatement(source);
  }
}

/**
 * The fixed-width export some banks still produce: columns at fixed offsets,
 * no header, one currency for the whole file.
 */
export class FixedWidthStatementParser extends StatementParser {
  readonly format = "fixed-width";

  constructor(private readonly currency: StatementRow["currency"]) {
    super();
  }

  recognises(source: string): boolean {
    const [first] = source.split("\n");
    return first !== undefined && first.length === 42 && !first.includes(",");
  }

  parse(source: string): readonly StatementRow[] {
    return source
      .split("\n")
      .filter((row) => row.length === 42)
      .map((row) => ({
        postedOn: row.slice(0, 10).trim(),
        description: row.slice(10, 34).trim(),
        amountMinor: Number(row.slice(34).trim()),
        currency: this.currency,
      }));
  }
}
