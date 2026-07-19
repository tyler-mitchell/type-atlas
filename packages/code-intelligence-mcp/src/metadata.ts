import { readFileSync } from "node:fs";
import type {
  Implementation,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import packageJson from "../package.json" with { type: "json" };

const iconData = readFileSync(
  new URL("../assets/code-intelligence.png", import.meta.url),
).toString("base64");

export const serverInfo = {
  name: "code-intelligence-mcp",
  title: "Code Intelligence MCP",
  version: packageJson.version,
  description: packageJson.description,
  websiteUrl: packageJson.homepage,
  icons: [{
    src: `data:image/png;base64,${iconData}`,
    mimeType: "image/png",
    sizes: ["64x64"],
  }],
} satisfies Implementation;

export const readOnlyToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;
