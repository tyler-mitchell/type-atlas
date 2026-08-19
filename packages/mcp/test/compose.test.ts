import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");

/**
 * The experimental composition surface: an agent authors one Markdoc document
 * in the design language — ask declarations, then a body composing what they
 * bind — and receives one answer holding several intelligences. The witness
 * composes a dossier over a real file and checks each section rendered from
 * real data, that an unknown operation is refused by name, and that a typo'd
 * binding is reported rather than silently rendered as a hole.
 */
test("compose renders a dossier from ask declarations", async () => {
  const client = new Client({ name: "type-atlas-compose-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=development", "src/cli.ts"],
    cwd: packageRoot,
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const dossier = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: [
          '{% ask "hover" as="head" file="packages/core/src/projection.ts" line=28 character=14 /%}',
          '{% ask "references" as="uses" file="packages/core/src/projection.ts" line=28 character=14 /%}',
          '{% ask "outline" as="shape" file="packages/core/src/projection.ts" /%}',
          '{% ask "source" as="body" file="packages/core/src/projection.ts" from=28 to=30 /%}',
          "",
          "## page, before the edit",
          "",
          "{% $head.text %}",
          "",
          "{% $uses.total %} uses in {% $uses.files %} files, across {% $uses.projects %} projects.",
          "",
          '{% tree entries=$uses.groups partial="reference-node.mdoc" /%}',
          "",
          "## The module around it",
          "",
          '{% tree entries=$shape.tree partial="symbol-node.mdoc" /%}',
          "",
          "## Its first lines",
          "",
          "{% source lines=$body.lines startLine=$body.startLine /%}",
        ].join("\n"),
      },
    });
    const text = dossier.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain("## page, before the edit");
    // The hover header carries the real signature.
    expect(text).toContain("const page");
    // The composed sentence reads real counts, not holes.
    expect(text).toMatch(/\d+ uses in \d+ files, across \d+ projects\./u);
    // The outline partial rendered the declaration this file exports.
    expect(text).toContain("page [");
    // The source tag rendered the asked line under its own number.
    expect(text).toContain("28");
    expect(text).not.toContain("Undefined in this composition");

    const refused = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: '{% ask "horoscope" as="stars" file="a.ts" /%}\n{% $stars.total %}',
      },
    });
    const refusal = refused.content.find((item) => item.type === "text")?.text ?? "";
    expect(refused.isError).toBe(true);
    expect(refusal).toContain('"horoscope"');
    expect(refusal).toContain("references");

    const holed = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document:
          '{% ask "outline" as="shape" file="packages/core/src/projection.ts" /%}\nTotal: {% $shpae.total %}',
      },
    });
    const holedText = holed.content.find((item) => item.type === "text")?.text ?? "";
    expect(holedText).toContain("Undefined in this composition: shpae");
    expect(holedText).toContain("the asks bind shape");

    // The markup is the query language: a document of bare asks is a complete
    // composition, and each answer renders in its canonical block without any
    // authored body.
    const bare = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: [
          '{% ask "hover" as="head" file="packages/core/src/projection.ts" line=28 character=14 /%}',
          '{% ask "references" as="uses" file="packages/core/src/projection.ts" line=28 character=14 /%}',
        ].join("\n"),
      },
    });
    const bareText = bare.content.find((item) => item.type === "text")?.text ?? "";
    expect(bareText).toContain("const page");
    expect(bareText).toContain("## References — packages/core/src/projection.ts:28:14");
    expect(bareText).toMatch(/\d+ uses in \d+ files, across \d+ projects\./u);
    expect(bareText).not.toContain("Undefined in this composition");

    // Asks chain: the second query reads the first answer's file list, so one
    // composition expresses "find the uses, then check the health of every
    // file holding one" — and the reversed order is an error a composer can
    // act on, not a hole.
    const chained = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: [
          '{% ask "references" as="uses" file="packages/core/src/projection.ts" line=28 character=14 /%}',
          '{% ask "diagnostics" as="health" files=$uses.paths /%}',
        ].join("\n"),
      },
    });
    const chainedText = chained.content.find((item) => item.type === "text")?.text ?? "";
    expect(chainedText).toContain("## Problems — $uses.paths");
    expect(chainedText).toMatch(/No problem in \d+ files? checked\./u);
    const reversed = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: '{% ask "diagnostics" as="health" files=$uses.paths /%}',
      },
    });
    expect(reversed.isError).toBe(true);
    expect(reversed.content.find((item) => item.type === "text")?.text ?? "").toContain(
      "reads earlier asks only",
    );

    // The exact presentation, over data stable enough to pin: the syntactic
    // outline and a source window compose exactly as their dedicated tools
    // render them, under headings the composer chose.
    const pinned = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: [
          '{% ask "outline" as="o" file="packages/core/src/projection.ts" /%}',
          '{% ask "source" as="body" file="packages/core/src/projection.ts" from=28 to=29 /%}',
          "## Declared here",
          '{% tree entries=$o.tree partial="symbol-node.mdoc" /%}',
          "## The declaration line",
          "{% source lines=$body.lines startLine=$body.startLine /%}",
        ].join("\n"),
      },
    });
    // The elapsed-time trailer is real output and not stable output.
    expect(
      (pinned.content.find((item) => item.type === "text")?.text ?? "").replace(/\n\n· .+$/u, ""),
    ).toMatchInlineSnapshot(`
      "## Declared here

      page [variable] 28:14-28:18 · range 28:14-36:2
      ├  ...(end < items.length ? { nextOffset: … [property] 34:5-34:55
      ├  end [variable] 29:9-29:12 · range 29:9-29:53
      ├  items [property] 33:5-33:10 · range 33:5-33:36
      ├  offset [property] 32:5-32:11
      └  total [property] 31:5-31:10 · range 31:5-31:24
      Page [interface] 4:13-4:17 · range 4:1-9:3
      projectDocumentSymbol [variable] 11:7-11:28 · range 11:7-19:2
      ├  item [property] 15:12-15:16 · range 15:9-15:16
      ├  children [variable] 12:11-12:19
      ├  children [property] 16:9-16:17 · range 16:9-16:83
      │  └  children.map() callback [function] 16:32-16:82
      └  item [variable] 12:24-12:28 · range 12:21-12:28
      projectDocumentSymbols [variable] 22:14-22:36 · range 22:14-25:98
      └  symbols.map() callback [function] 25:18-25:97

      ## The declaration line

      28 | export const page = <Item>(items: readonly Item[], offset: number, limit: number): Page<Item> => {
      29 |   const end = Math.min(offset + limit, items.length);"
    `);
  } finally {
    await client.close();
  }
}, 60_000);
