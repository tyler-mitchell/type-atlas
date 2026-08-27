import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "vite-plus/test";

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
          '{% ask "document_symbols" as="shape" file="packages/core/src/projection.ts" /%}',
          '{% ask "read_file" as="body" file="packages/core/src/projection.ts" from=28 to=30 /%}',
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
          '{% ask "document_symbols" as="shape" file="packages/core/src/projection.ts" /%}\nTotal: {% $shpae.total %}',
      },
    });
    const holedText = holed.content.find((item) => item.type === "text")?.text ?? "";
    expect(holedText).toContain("Undefined in this composition: shpae");
    expect(holedText).toContain("the asks bind shape");

    // The agent is the author: a document with no body renders nothing —
    // the tool never writes markup on the composer's behalf.
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
    expect(bare.content.find((item) => item.type === "text")?.text ?? "").toBe("");

    // Asks chain: the second query reads the first answer's file list, so one
    // authored composition expresses "find the uses, then check the health of
    // every file holding one" — and the reversed order is an error a composer
    // can act on, not a hole.
    const chained = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: [
          '{% ask "references" as="uses" file="packages/core/src/projection.ts" line=28 character=14 /%}',
          '{% ask "diagnostics" as="health" files=$uses.paths /%}',
          "",
          "Health of the {% $uses.files %} files using page: {% $health.total %} problems in {% $health.checked %} checked.",
        ].join("\n"),
      },
    });
    const chainedText = chained.content.find((item) => item.type === "text")?.text ?? "";
    expect(chainedText).toMatch(
      /Health of the \d+ files using page: \d+ problems in \d+ checked\./u,
    );

    // Subject and callers primitives populate an authored card, and one ask
    // failing on a missing file is stated in feedback while the others answer.
    const fleshed = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: [
          '{% ask "subject" as="what" file="packages/core/src/projection.ts" line=28 character=14 /%}',
          '{% ask "callers" as="calledBy" file="packages/core/src/markdoc/render.ts" line=69 character=14 /%}',
          '{% ask "document_symbols" as="broken" file="packages/core/src/does-not-exist.ts" /%}',
          "",
          "## {% $what.name %}",
          "",
          "{% $what.name %} [{% $what.kind %}] · {% $what.file %}:{% position($what.at) %}",
          "",
          "renderDocument is called from {% $calledBy.total %} places.",
        ].join("\n"),
      },
    });
    const fleshedText = fleshed.content.find((item) => item.type === "text")?.text ?? "";
    expect(fleshedText).toContain("## page");
    expect(fleshedText).toContain("page [");
    expect(fleshedText).toContain("packages/core/src/projection.ts:28:14");
    expect(fleshedText).toMatch(/renderDocument is called from \d+ places\./u);
    expect(fleshedText).toContain("The document_symbols ask binding broken failed:");
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

    // Naming a declaration is the ergonomic form, and both ways it can be
    // wrong are sentences a composer can act on rather than holes. Fanning
    // over something that is not a list is the third: it used to degrade to a
    // single un-anchored call and answer about nothing.
    const pointed = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: [
          '{% ask "hover" as="head" file="packages/core/src/projection.ts" symbol="page" /%}',
          '{% ask "hover" as="absent" file="packages/core/src/projection.ts" symbol="noSuchThing" /%}',
          '{% ask "hover" as="fanned" each=$head.nope /%}',
          "{% $head.text %}",
        ].join("\n"),
      },
    });
    const pointedText = pointed.content.find((item) => item.type === "text")?.text ?? "";
    expect(pointedText).toContain("const page");
    expect(pointedText).toContain('declares no "noSuchThing"');
    expect(pointedText).toContain("each=$head.nope is not a list");

    // An ask runs once per item of a list an earlier ask bound, and the
    // places one ask reports are what another ask points at — including
    // `files=`, where passing the hits straight through once stringified
    // every place to "[object Object]".
    const fanned = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: [
          '{% ask "workspace_symbols" as="q" file="packages/core/src/projection.ts" query="page" /%}',
          '{% ask "hover" as="each" each=$q.hits /%}',
          '{% ask "diagnostics" as="health" files=$q.hits /%}',
          "fanned {% $each.total %} of {% $each.of %} · checked {% $health.checked %}",
          "",
          "{% $each.text %}",
        ].join("\n"),
      },
    });
    const fannedText = fanned.content.find((item) => item.type === "text")?.text ?? "";
    expect(fannedText).toMatch(/fanned [1-9]\d* of [1-9]\d* · checked [1-9]/u);
    // Each answer is titled by the place it came from, so repeated blocks are
    // told apart without the composer restating the list.
    expect(fannedText).toContain("## page · packages/core/src/projection.ts:");

    // The exact presentation, over data stable enough to pin: the syntactic
    // outline and a source window compose exactly as their dedicated tools
    // render them, under headings the composer chose.
    const pinned = await client.callTool({
      name: "compose",
      arguments: {
        workspace: workspaceRoot,
        document: [
          '{% ask "document_symbols" as="o" file="packages/core/src/projection.ts" /%}',
          '{% ask "read_file" as="body" file="packages/core/src/projection.ts" from=28 to=29 /%}',
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
      Page [interface] 4:13-4:17 · range 4:1-9:3
      projectDocumentSymbol [variable] 11:7-11:28 · range 11:7-19:2
      projectDocumentSymbols [variable] 22:14-22:36 · range 22:14-25:98

      ## The declaration line

      28 | export const page = <Item>(items: readonly Item[], offset: number, limit: number): Page<Item> => {
      29 |   const end = Math.min(offset + limit, items.length);"
    `);
  } finally {
    await client.close();
  }
}, 60_000);
