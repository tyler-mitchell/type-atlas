import * as path from "node:path";
import type { Location, LocationLink, Range } from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";

export type SemanticLocation = Location | LocationLink;

type NormalizedSemanticLocation = {
  uri: string;
  range: Range;
};

function normalizeSemanticLocation(
  location: SemanticLocation,
): NormalizedSemanticLocation {
  return {
    uri: "targetUri" in location ? location.targetUri : location.uri,
    range: "targetRange" in location ? location.targetRange : location.range,
  };
}

function getSemanticLocationKey(location: SemanticLocation): string {
  const normalized = normalizeSemanticLocation(location);
  return [
    normalized.uri,
    normalized.range.start.line,
    normalized.range.start.character,
    normalized.range.end.line,
    normalized.range.end.character,
  ].join(":");
}

export function formatSemanticLocation(
  rootDir: string,
  location: SemanticLocation,
): string {
  const normalized = normalizeSemanticLocation(location);
  const targetPath = path.relative(rootDir, URI.parse(normalized.uri).fsPath);
  const line = normalized.range.start.line + 1;
  const col = normalized.range.start.character + 1;
  return `${targetPath}:${line}:${col}`;
}

export function dedupeSemanticLocations<T extends SemanticLocation>(
  locations: readonly T[],
): T[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = getSemanticLocationKey(location);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function excludeSemanticLocations<T extends SemanticLocation>(
  locations: readonly T[],
  excludedLocations: readonly SemanticLocation[],
): T[] {
  const excludedKeys = new Set(excludedLocations.map(getSemanticLocationKey));
  return dedupeSemanticLocations(locations).filter(
    (location) => !excludedKeys.has(getSemanticLocationKey(location)),
  );
}
