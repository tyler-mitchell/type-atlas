/**
 * FeatureType MCP Server
 *
 * Exposes Volar/TypeScript language service as MCP tools
 * for agent diagnostic intelligence.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "node:path";
import { URI } from "vscode-uri";
import type { DocumentSymbol } from "vscode-languageserver-protocol";
import { createVolarHost, type VolarHost } from "./volar-host.js";
import { getDiagnostics, snapshotBaseline } from "./tools/diagnostics.js";
import { getTypeAt, getSignature } from "./tools/type-info.js";
import { getDefinition, getReferences } from "./tools/navigation.js";
import { getCodeActions } from "./tools/actions.js";
import { getEnrichedFile } from "./tools/enriched-file.js";

/**
 * Manages multiple Volar hosts keyed by project root.
 * Resolves the correct host for a given file path.
 */
class HostManager {
  private hosts = new Map<string, VolarHost>();
  private activeRoot: string;

  constructor(initialRoot: string) {
    this.activeRoot = path.resolve(initialRoot);
    this.hosts.set(this.activeRoot, createVolarHost(this.activeRoot));
  }

  getActive(): VolarHost {
    return this.hosts.get(this.activeRoot)!;
  }

  /** Resolve the best host for a file path. Falls back to active host. */
  resolveForFile(filePath: string): VolarHost {
    const absPath = path.resolve(this.activeRoot, filePath);
    // Check if any attached project root contains this file
    for (const [root, host] of this.hosts) {
      if (absPath.startsWith(root + path.sep) || absPath === root) {
        return host;
      }
    }
    return this.getActive();
  }

  attach(projectRoot: string): { root: string; fileCount: number; isNew: boolean } {
    const resolved = path.resolve(projectRoot);
    if (this.hosts.has(resolved)) {
      const host = this.hosts.get(resolved)!;
      this.activeRoot = resolved;
      return { root: resolved, fileCount: host.getProjectFileNames().length, isNew: false };
    }
    const host = createVolarHost(resolved);
    this.hosts.set(resolved, host);
    this.activeRoot = resolved;
    return { root: resolved, fileCount: host.getProjectFileNames().length, isNew: true };
  }

  listRoots(): Array<{ root: string; active: boolean; fileCount: number }> {
    return [...this.hosts.entries()].map(([root, host]) => ({
      root,
      active: root === this.activeRoot,
      fileCount: host.getProjectFileNames().length,
    }));
  }

  disposeAll() {
    for (const host of this.hosts.values()) {
      host.dispose();
    }
  }
}

export function createMcpServer(manager: HostManager): McpServer {
  const server = new McpServer({
    name: "featuretype",
    version: "0.0.0",
  });

  // --- Project management ---

  server.tool(
    "attach_project",
    "Attach a new TypeScript project root for semantic analysis. The attached project becomes the active root. Use this when working across multiple repos or when semantic queries fail because a file is outside the current project graph.",
    {
      projectRoot: z.string().describe("Absolute or relative path to the project root (directory containing tsconfig.json)"),
    },
    async (args) => {
      const result = manager.attach(args.projectRoot);
      const status = result.isNew ? "Attached new project" : "Switched to existing project";
      return {
        content: [{
          type: "text",
          text: `${status}: ${result.root}\n  ${result.fileCount} files in project graph\n  This is now the active project root.`,
        }],
      };
    },
  );

  server.tool(
    "list_projects",
    "List all attached project roots and which is currently active.",
    {},
    async () => {
      const roots = manager.listRoots();
      const lines = roots.map((r) =>
        `${r.active ? "→ " : "  "}${r.root} (${r.fileCount} files)`,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  );

  // --- Diagnostic tools ---

  server.tool(
    "get_diagnostics",
    "Get TypeScript errors and warnings for a file or the whole project. Returns structured diagnostics with baseline awareness (new vs pre-existing errors). Use summary mode for project-wide scans to avoid large output.",
    {
      file: z.string().optional().describe("File path relative to project root. Omit for all project diagnostics."),
      scope: z.enum(["new", "baseline", "all"]).optional().describe("Filter: 'new' for errors you introduced, 'baseline' for pre-existing, 'all' for both (default: all)"),
      severity: z.enum(["error", "warning", "all"]).optional().describe("Filter by severity (default: all)"),
      summary: z.boolean().optional().describe("If true, return grouped counts by file instead of full diagnostic XML. Useful for project-wide scans."),
    },
    async (args) => {
      const host = args.file ? manager.resolveForFile(args.file) : manager.getActive();
      return {
        content: [{ type: "text", text: await getDiagnostics(host, args) }],
      };
    },
  );

  server.tool(
    "snapshot_baseline",
    "Capture current diagnostic state as baseline for the active project. Subsequent get_diagnostics calls will tag errors as 'new' or 'baseline'. Call this before making changes to distinguish your errors from pre-existing ones.",
    {},
    async () => ({
      content: [{ type: "text", text: await snapshotBaseline(manager.getActive()) }],
    }),
  );

  // --- Type information tools ---

  server.tool(
    "get_type_at",
    "Get the inferred type and documentation at a position (hover equivalent). Use to understand what the compiler thinks a value is.",
    {
      file: z.string().describe("File path relative to project root"),
      line: z.number().describe("Line number (1-based)"),
      col: z.number().describe("Column number (1-based)"),
    },
    async (args) => ({
      content: [{ type: "text", text: await getTypeAt(manager.resolveForFile(args.file), args) }],
    }),
  );

  server.tool(
    "get_signature",
    "Get function signature help at a call site. Returns parameter names, types, overloads, and documentation.",
    {
      file: z.string().describe("File path relative to project root"),
      line: z.number().describe("Line number (1-based)"),
      col: z.number().describe("Column number (1-based)"),
    },
    async (args) => ({
      content: [{ type: "text", text: await getSignature(manager.resolveForFile(args.file), args) }],
    }),
  );

  // --- Navigation tools ---

  server.tool(
    "get_definition",
    "Go to definition. Returns the declaration site, resolved through re-exports, aliases, and generated types.",
    {
      file: z.string().describe("File path relative to project root"),
      line: z.number().describe("Line number (1-based)"),
      col: z.number().describe("Column number (1-based)"),
    },
    async (args) => ({
      content: [{ type: "text", text: await getDefinition(manager.resolveForFile(args.file), args) }],
    }),
  );

  server.tool(
    "get_references",
    "Find all references to a symbol (type-aware, not regex). Returns all usage sites across the project.",
    {
      file: z.string().describe("File path relative to project root"),
      line: z.number().describe("Line number (1-based)"),
      col: z.number().describe("Column number (1-based)"),
    },
    async (args) => ({
      content: [{ type: "text", text: await getReferences(manager.resolveForFile(args.file), args) }],
    }),
  );

  // --- Code actions ---

  server.tool(
    "get_code_actions",
    "Get compiler-known quick fixes and refactors for a range. Returns available fixes like add import, narrow type, implement interface.",
    {
      file: z.string().describe("File path relative to project root"),
      startLine: z.number().describe("Start line (1-based)"),
      startCol: z.number().describe("Start column (1-based)"),
      endLine: z.number().describe("End line (1-based)"),
      endCol: z.number().describe("End column (1-based)"),
    },
    async (args) => ({
      content: [{ type: "text", text: await getCodeActions(manager.resolveForFile(args.file), args) }],
    }),
  );

  // --- Enriched file ---

  server.tool(
    "get_enriched_file",
    "Get file source with diagnostics and type information woven inline as annotations. Expensive but gives a complete picture. Use sparingly.",
    {
      file: z.string().describe("File path relative to project root"),
    },
    async (args) => ({
      content: [{ type: "text", text: await getEnrichedFile(manager.resolveForFile(args.file), args) }],
    }),
  );

  // --- Hover and symbols ---

  server.tool(
    "get_hover",
    "Get hover information at a position. For .featuretype files, returns schema descriptions for block tags. For TS/TSX, returns inferred types and JSDoc. Similar to get_type_at but includes all hover content.",
    {
      file: z.string().describe("File path relative to project root"),
      line: z.number().describe("Line number (1-based)"),
      col: z.number().describe("Column number (1-based)"),
    },
    async (args) => {
      const host = manager.resolveForFile(args.file);
      const absPath = path.resolve(host.rootDir, args.file);
      const uri = URI.file(absPath);
      const hover = await host.languageService.getHover(uri, {
        line: args.line - 1,
        character: args.col - 1,
      });
      if (!hover) {
        const { explainFailure } = await import("./failure.js");
        return {
          content: [{ type: "text" as const, text: explainFailure("get_hover", args.file, host, { position: `${args.line}:${args.col}` }) }],
        };
      }
      let text: string;
      if (typeof hover.contents === "string") {
        text = hover.contents;
      } else if (Array.isArray(hover.contents)) {
        text = hover.contents.map((c: string | { language: string; value: string }) => (typeof c === "string" ? c : c.value)).join("\n\n");
      } else {
        text = hover.contents.value;
      }
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "get_document_symbols",
    "Get the symbol outline of a file. For .featuretype files, returns the block structure (intent, anatomy, recipe, etc). For TS/TSX, returns functions, classes, interfaces, etc.",
    {
      file: z.string().describe("File path relative to project root"),
    },
    async (args) => {
      const host = manager.resolveForFile(args.file);
      const absPath = path.resolve(host.rootDir, args.file);
      const uri = URI.file(absPath);
      const symbols = await host.languageService.getDocumentSymbols(uri);
      if (!symbols || symbols.length === 0) {
        return { content: [{ type: "text" as const, text: `No symbols found in ${args.file}` }] };
      }
      function formatSymbol(sym: DocumentSymbol, indent: number): string {
        const prefix = "  ".repeat(indent);
        const range = `${sym.range.start.line + 1}:${sym.range.start.character + 1}`;
        const detail = sym.detail ? ` — ${sym.detail}` : "";
        let result = `${prefix}${sym.name}${detail} (line ${range})`;
        if (sym.children) {
          for (const child of sym.children) {
            result += `\n${formatSymbol(child, indent + 1)}`;
          }
        }
        return result;
      }
      const text = symbols.map((s) => formatSymbol(s, 0)).join("\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // --- File notification ---

  server.tool(
    "notify_file_changed",
    "Notify the server that a file has changed on disk. Call this after writing or modifying files so diagnostics stay current.",
    {
      file: z.string().describe("File path relative to project root"),
    },
    async (args) => {
      const host = manager.resolveForFile(args.file);
      host.notifyFileChanged(args.file);
      return {
        content: [{ type: "text", text: `Acknowledged: ${args.file} updated` }],
      };
    },
  );

  return server;
}

export async function startServer(projectRoot: string): Promise<void> {
  const manager = new HostManager(projectRoot);

  // Auto-snapshot baseline on startup
  await snapshotBaseline(manager.getActive());

  const server = createMcpServer(manager);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean up on exit
  process.on("SIGINT", () => {
    manager.disposeAll();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    manager.disposeAll();
    process.exit(0);
  });
}
