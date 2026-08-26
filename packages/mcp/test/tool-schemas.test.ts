import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { beforeAll, expect, test } from "vite-plus/test";
import { intentDescription, toolPolicies } from "../src/tool.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * MCP publishes a tool's input as an object schema — `type`, `properties`,
 * `required`. A schema it cannot represent still registers and still validates
 * incoming arguments; it simply advertises nothing for a client to send, and
 * the tool then fails every call complaining about an argument the caller did
 * supply. Nothing surfaces that at build time, so these assertions read what
 * the packaged server actually publishes rather than the arktype definitions
 * behind it.
 *
 * A union nested under a property is ordinary JSON Schema and stays allowed.
 * What is rejected here is a schema that says nothing, and the two ways
 * arktype silently emits something other than what the definition meant.
 */
type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * `.configure(meta)` attaches metadata to each branch of a union, which turns
 * an enum into a list of annotated constants and loses the enum. Passing the
 * `"self"` selector keeps it on the union itself. The two are indistinguishable
 * at the definition site and obvious here.
 */
const isExplodedEnum = (schema: Schema): boolean => {
  const branches = schema["anyOf"];
  return (
    Array.isArray(branches) &&
    branches.length > 0 &&
    branches.every((branch) => isSchema(branch) && "const" in branch)
  );
};

const arktypeMarkers = (node: unknown, path: string): readonly string[] => {
  if (typeof node === "string") {
    return node.startsWith("$ark.") ? [`${path} is the arktype marker ${node}`] : [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((entry, index) => arktypeMarkers(entry, `${path}[${index}]`));
  }
  if (!isSchema(node)) return [];
  return Object.entries(node).flatMap(([key, value]) => arktypeMarkers(value, `${path}.${key}`));
};

let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];

const properties = (schema: { readonly properties?: unknown }): readonly [string, Schema][] =>
  Object.entries(schema.properties ?? {}).filter((entry): entry is [string, Schema] =>
    isSchema(entry[1]),
  );

beforeAll(async () => {
  const client = new Client({ name: "type-atlas-schema-test", version: "1.0.0" });
  // The source entrypoint, because that is what every client attaches. Reading
  // `bin/type-atlas.cjs` here would assert against whatever was last built, so
  // a schema defect in the working tree passes and the same defect reaches
  // every agent the moment they connect.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=development", "src/cli.ts"],
    cwd: packageRoot,
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    ({ tools } = await client.listTools());
  } finally {
    await client.close();
  }
});

test("every tool publishes an object input schema", () => {
  expect(tools.length).toBeGreaterThan(0);
  expect(tools.filter(({ inputSchema }) => inputSchema.type !== "object").map(({ name }) => name)) //
    .toEqual([]);
});

test("every tool advertises the arguments it accepts", () => {
  expect(
    tools
      .filter(({ inputSchema }) => Object.keys(inputSchema.properties ?? {}).length === 0)
      .map(({ name }) => name),
  ).toEqual([]);
});

test("every published property declares a concrete type or enum", () => {
  expect(
    tools.flatMap(({ name, inputSchema }) =>
      properties(inputSchema)
        .filter(([, schema]) => !("type" in schema || "enum" in schema))
        .map(([property]) => `${name}.${property}`),
    ),
  ).toEqual([]);
});

/**
 * A choice at the property itself leaves it with no type, and a client then
 * coerces whatever is sent to a string: an array arrives as its JSON text, a
 * number as digits. `snippetLines` published as `null | integer` failed exactly
 * that way, turning 12 into "12".
 *
 * Deeper choices are fine, and the assertion above is what enforces the
 * difference. `read_file.file` publishes `type: "array"` whose items may be a
 * path or a bounded view: the container names the shape, so elements travel as
 * the JSON they are, which a mixed call confirms.
 */
test("no property replaces its own type with a choice", () => {
  expect(
    tools.flatMap(({ name, inputSchema }) =>
      properties(inputSchema)
        .filter((entry) => ["anyOf", "oneOf", "allOf", "not"].some((key) => key in entry[1]))
        .filter(([, schema]) => !("type" in schema || "enum" in schema))
        .map(([property]) => `${name}.${property}`),
    ),
  ).toEqual([]);
});

test("no enum is published as a list of annotated constants", () => {
  expect(
    tools.flatMap(({ name, inputSchema }) =>
      properties(inputSchema)
        .filter(([, schema]) => isExplodedEnum(schema))
        .map(([property]) => `${name}.${property}`),
    ),
  ).toEqual([]);
});

test("every published property documents itself", () => {
  expect(
    tools.flatMap(({ name, inputSchema }) =>
      properties(inputSchema)
        .filter(([, schema]) => typeof schema["description"] !== "string")
        .map(([property]) => `${name}.${property}`),
    ),
  ).toEqual([]);
});

/**
 * Undeclared keys pass, by standing order: rejection was built to catch
 * typos, caught none, and instructed clients — via additionalProperties:
 * false in every advertised schema — to silently delete each legitimately
 * new argument a stale session sent. The published schemas may never carry
 * that instruction again.
 */
test("no tool tells clients to delete arguments it does not declare", () => {
  expect(
    tools
      .filter(({ inputSchema }) => (inputSchema as Schema)["additionalProperties"] === false)
      .map(({ name }) => name),
  ).toEqual([]);
});

test("no default is published as an arktype marker", () => {
  expect(tools.flatMap(({ name, inputSchema }) => arktypeMarkers(inputSchema.properties, name))) //
    .toEqual([]);
});

test("require-intent applies only to broad exploration", async () => {
  const client = new Client({ name: "type-atlas-intent-schema-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=development", "src/cli.ts", "--require-intent"],
    cwd: packageRoot,
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    const listed = (await client.listTools()).tools;
    expect(Object.keys(toolPolicies).sort()).toEqual(listed.map(({ name }) => name).sort());
    for (const { name, inputSchema } of listed) {
      const policy = toolPolicies[name as keyof typeof toolPolicies];
      expect(inputSchema.required?.includes("intent") ?? false).toBe(policy.requireIntent);
      if (!policy.requireIntent) continue;
      expect(properties(inputSchema).find(([name]) => name === "intent")?.[1]).toMatchObject({
        maxLength: 160,
        description: intentDescription,
      });
    }
  } finally {
    await client.close();
  }
}, 15_000);
