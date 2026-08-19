/**
 * A word with the English indefinite article that belongs to it.
 *
 * Not a vowel test. `a`/`an` follows the *sound* a word starts with, not its
 * letter — "an hour", "a union", "a one-liner", "an SVG" — so a regex over the
 * first character is wrong for every one of those and right only by accident
 * for the rest.
 *
 * This is English grammar hard-coded, and it is the one thing here that has no
 * business being hand-written: ICU MessageFormat expresses it as a `select`
 * over the word, enumerated and specified. Until this library grounds to that,
 * the exceptions are listed rather than guessed, so a wrong answer is a missing
 * entry rather than a rule that never held.
 */
const soundsVowelInitial = new Set(["hour", "honest", "heir"]);
const soundsConsonantInitial = new Set(["union", "unique", "one", "user", "unit"]);

export const withArticle = (word: string) => {
  const first = word.split(/\s+/)[0]?.toLowerCase() ?? "";
  const vowel = soundsVowelInitial.has(first)
    ? true
    : soundsConsonantInitial.has(first)
      ? false
      : /^[aeiou]/.test(first);
  return `${vowel ? "an" : "a"} ${word}`;
};
