/**
 * Every word this library emits, in one keyspace.
 *
 * Before this, each component invented its own parameter for its words —
 * `counts(empty)`, `diff(expected, received)`, `diagnostics(severities,
 * unknown)`, `scope(label, names)`. Eleven of them. A translator had to
 * discover each one by reading the source, and any component that forgot to
 * take a parameter was simply untranslatable.
 *
 * Dotted keys are the translation-file convention for the same reason they are
 * the config convention: they group by subject, so `diagnostic.*` is one
 * section of a catalog and a missing key is visible against its siblings.
 *
 * The line this draws: words the *library* chooses live here. Words about the
 * caller's domain do not — `noun({singular, plural})` still takes them, because
 * "reference"/"references" is the caller's vocabulary and no catalog of ours
 * could hold it.
 */
import { message } from "../text/message.ts";

export type Messages = Readonly<Record<string, string>>;

export const defaultMessages: Messages = {
  "diagnostic.severity.1": "error",
  "diagnostic.severity.2": "warning",
  "diagnostic.severity.3": "info",
  "diagnostic.severity.4": "hint",

  "symbol.kind.1": "file",
  "symbol.kind.2": "module",
  "symbol.kind.3": "namespace",
  "symbol.kind.4": "package",
  "symbol.kind.5": "class",
  "symbol.kind.6": "method",
  "symbol.kind.7": "property",
  "symbol.kind.8": "field",
  "symbol.kind.9": "constructor",
  "symbol.kind.10": "enum",
  "symbol.kind.11": "interface",
  "symbol.kind.12": "function",
  "symbol.kind.13": "variable",
  "symbol.kind.14": "constant",
  "symbol.kind.15": "string",
  "symbol.kind.16": "number",
  "symbol.kind.17": "boolean",
  "symbol.kind.18": "array",
  "symbol.kind.19": "object",
  "symbol.kind.20": "key",
  "symbol.kind.21": "null",
  "symbol.kind.22": "enum member",
  "symbol.kind.23": "struct",
  "symbol.kind.24": "event",
  "symbol.kind.25": "operator",
  "symbol.kind.26": "type parameter",
  "diagnostic.severity.unknown": "problem",

  "diff.expected": "Expected",
  "diff.received": "Received",
  // Selection is the message's own business now, so the two forms live in it
  // rather than being chosen by a caller and passed back in.
  "diff.omitted":
    ".input {$count :integer}\n.match $count\none {{{$count} unchanged line}}\n* {{{$count} unchanged lines}}",

  "counts.empty": "none",

  // Quoted, because a message beginning with `.` is read as a declaration
  // keyword — `.input`, `.match` — and this one opens with an ellipsis.
  "fold.placeholder": "{{... {$from}-{$to} folded}}",

  "range.extent": "range",
};

/**
 * One message from the catalog, formatted.
 *
 * The formatting is MessageFormat 2 — the Unicode spec, locked in LDML 48 —
 * rather than the `{placeholder}` substitution this used to do by hand. A
 * message can therefore select on plural category, on ordinal, or on any value,
 * and format a number or a date, without the library growing a second mechanism
 * beside this one to do it.
 *
 * A missing key returns the key itself rather than empty text: a catalog with a
 * hole should be obvious in the output, not silently blank. That is the same
 * reasoning as never printing a zero state — an absence that looks like content
 * is worse than one that announces itself.
 */
export const translate = (input: {
  readonly key: string;
  readonly messages?: Messages;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly locale?: string;
}) => {
  const source = (input.messages ?? defaultMessages)[input.key] ?? defaultMessages[input.key];
  if (source === undefined) return input.key;
  return message({ source, values: input.values, locale: input.locale });
};
