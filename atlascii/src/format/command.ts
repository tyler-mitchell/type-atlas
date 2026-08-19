/** A GitHub workflow command's message body. */
export const commandText = (value: string) =>
  value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/**
 * A GitHub workflow command's property value.
 *
 * Stricter than the body: `:` separates the command from its message and `,`
 * separates properties, so both must go.
 */
export const commandProperty = (value: string) =>
  commandText(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

/**
 * A GitHub workflow command: `::error file=…,line=…::message`.
 *
 * Properties whose value is absent are left out rather than emitted empty,
 * which GitHub reads as a literal empty value.
 */
export const command = (input: {
  readonly kind: string;
  readonly message: string;
  readonly properties?: Readonly<Record<string, string | number | undefined>>;
}) => {
  const properties = Object.entries(input.properties ?? {})
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `${name}=${commandProperty(String(value))}`)
    .join(",");
  return `::${input.kind}${properties ? ` ${properties}` : ""}::${commandText(input.message)}`;
};
