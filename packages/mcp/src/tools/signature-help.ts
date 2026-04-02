import type { DiagnosticsSession } from "@featuretype/language-server";
import type { Position, SignatureHelp } from "vscode-languageserver-protocol";

const CURSOR_SCAN_RADIUS = 2;
const SIGNATURE_DELIMITERS = new Set(["(", ","]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildLineStarts(text: string): number[] {
  const lineStarts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  return lineStarts;
}

function getLineBounds(
  text: string,
  lineStarts: readonly number[],
  line: number,
): { start: number; end: number } {
  const safeLine = clamp(line, 0, Math.max(0, lineStarts.length - 1));
  const start = lineStarts[safeLine] ?? 0;
  const nextLineStart = lineStarts[safeLine + 1] ?? text.length;

  let end = nextLineStart;
  while (end > start && (text[end - 1] === "\n" || text[end - 1] === "\r")) {
    end -= 1;
  }

  return { start, end };
}

function positionToOffset(text: string, position: Position): number {
  const lineStarts = buildLineStarts(text);
  const { start, end } = getLineBounds(text, lineStarts, position.line);
  const safeCharacter = clamp(position.character, 0, end - start);
  return start + safeCharacter;
}

function offsetToPosition(text: string, offset: number): Position {
  const lineStarts = buildLineStarts(text);
  const safeOffset = clamp(offset, 0, text.length);

  let line = 0;
  while (
    line + 1 < lineStarts.length &&
    (lineStarts[line + 1] ?? text.length + 1) <= safeOffset
  ) {
    line += 1;
  }

  return {
    line,
    character: safeOffset - (lineStarts[line] ?? 0),
  };
}

function findPreviousOffset(
  text: string,
  offset: number,
  predicate: (char: string) => boolean,
): number | null {
  for (let index = clamp(offset, 0, Math.max(0, text.length - 1)); index >= 0; index -= 1) {
    if (predicate(text[index] ?? "")) {
      return index;
    }
  }

  return null;
}

function findNextOffset(
  text: string,
  offset: number,
  predicate: (char: string) => boolean,
): number | null {
  for (let index = clamp(offset, 0, text.length); index < text.length; index += 1) {
    if (predicate(text[index] ?? "")) {
      return index;
    }
  }

  return null;
}

function isMeaningfulCharacter(char: string): boolean {
  return char.trim().length > 0;
}

function buildCandidatePositions(text: string, position: Position): Position[] {
  const requestedOffset = positionToOffset(text, position);
  const rawOffsets = [
    requestedOffset,
    ...Array.from({ length: CURSOR_SCAN_RADIUS }, (_, index) => requestedOffset - (index + 1)),
    ...Array.from({ length: CURSOR_SCAN_RADIUS }, (_, index) => requestedOffset + (index + 1)),
    findPreviousOffset(text, requestedOffset - 1, isMeaningfulCharacter),
    findNextOffset(text, requestedOffset, isMeaningfulCharacter),
    (() => {
      const delimiterOffset = findPreviousOffset(
        text,
        requestedOffset - 1,
        (char) => SIGNATURE_DELIMITERS.has(char),
      );
      return delimiterOffset === null ? null : delimiterOffset + 1;
    })(),
    (() => {
      const delimiterOffset = findNextOffset(
        text,
        requestedOffset,
        (char) => SIGNATURE_DELIMITERS.has(char),
      );
      return delimiterOffset === null ? null : delimiterOffset + 1;
    })(),
  ];

  const seen = new Set<string>();

  return rawOffsets
    .filter((offset): offset is number => typeof offset === "number")
    .map((offset) => offsetToPosition(text, offset))
    .filter((candidate) => {
      const key = `${candidate.line}:${candidate.character}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

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

export async function findSignatureHelp(
  session: DiagnosticsSession,
  filePath: string,
  position: Position,
): Promise<SignatureHelp | null> {
  let candidatePositions = [position];

  try {
    candidatePositions = buildCandidatePositions(
      session.getFileContent(filePath),
      position,
    );
  } catch {
    // Fall back to the exact position when the file cannot be read locally.
  }

  for (const candidate of candidatePositions) {
    const help = await session.getFileSignatureHelp(filePath, candidate);
    if (help && help.signatures.length > 0) {
      return help;
    }
  }

  return null;
}
