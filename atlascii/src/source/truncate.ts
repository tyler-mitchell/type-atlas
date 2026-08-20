export function truncateString(string: string, maxLength: number): string {
  if (string.length <= maxLength) {
    return string;
  }
  let end = maxLength - 1;
  if (isHighSurrogate(string[end - 1])) {
    end = end - 1;
  }
  return `${string.slice(0, end)}…`;
}

// https://github.com/chaijs/loupe/pull/79
function isHighSurrogate(char: string): boolean {
  return char >= "\uD800" && char <= "\uDBFF";
}
