import type { VolarWorkspacePool } from "@type-atlas/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { createDependencySearch } from "./dependency-search.ts";
import { createRetrievalIntelligence } from "./intelligence.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { textResult } from "./mcp-result.ts";
import type { Semble } from "./semble.ts";
import { fileInput } from "./tool-input.ts";
import { positionInput } from "./tool-input.ts";
import { symbolTarget } from "./navigation.tools.ts";
import { registerTool } from "./tool.ts";

const resultLimit = type("1 <= number.integer <= 20").configure({
  default: 5,
  description: "Maximum retrieval matches returned (1-20).",
});

const snippetLines = type("null | 0 <= number.integer <= 30").configure({
  default: 10,
  description:
    "Source lines included for each retrieval match (0-30); pass null for the complete chunk.",
});

const investigationResultLimit = type("1 <= number.integer <= 20").configure({
  default: 3,
  description: "Maximum retrieval matches returned (1-20).",
});

const investigationInspectionLimit = type("1 <= number.integer <= 5").configure({
  default: 2,
  description:
    "Maximum distinct retrieved candidates given verified relationships (1-5). Exact identifier matches inspect only that symbol.",
});

const investigationRelatedLimit = type("0 <= number.integer <= 20").configure({
  default: 0,
  description:
    "Optional structurally similar results derived from the first inspected candidate (0-20).",
});

const investigationSnippetLines = type("null | 0 <= number.integer <= 30").configure({
  default: 6,
  description:
    "Source lines included for each retrieval match (0-30); pass null for the complete chunk.",
});

const scope = type("string >= 1").configure({
  description:
    "Optional workspace-relative directory to search. Each distinct scope has a separate Semble index; prefer a stable package or app boundary.",
});

const includeTypes = type("boolean").configure({
  default: false,
  description: "Include hover types and documentation for every match.",
});

const exploreOptions = {
  ...fileInput,
  "scope?": scope,
  "includeSource?": type("boolean").configure({
    default: false,
    description: "Include the complete selected symbol body.",
  }),
  "includeTypeDefinitions?": type("boolean").configure({
    default: false,
    description: "Include callable type-definition targets.",
  }),
  "limit?": type("1 <= number.integer <= 100").configure({
    default: 12,
    description: "Maximum verified relationships shown per section (1-100).",
  }),
  "relatedLimit?": investigationResultLimit,
  "snippetLines?": investigationSnippetLines,
} as const;

const input = type.module({
  DependencySearch: type({
    ...fileInput,
    package: type("(string >= 1)[]").atLeastLength(1).configure(
      {
        description: "One or more installed package names, resolved from the importing file.",
      },
      "self",
    ),
    query: type("string >= 1").configure({
      description: "Behavior, concept, or identifier to find in package code.",
    }),
    "path?": type("(string >= 1)[]").configure(
      {
        description:
          'Nested runtime export path to search, such as ["Effect"] or ["default"]. Defaults to the top-level exports.',
      },
      "self",
    ),
    "surface?": type("'runtime' | 'all'").configure(
      {
        default: "runtime",
        description: "Runtime exports by default; use all when type-only exports are relevant.",
      },
      "self",
    ),
    "type?": type("string >= 1").configure({
      description: "Exported type whose instance or chained methods should be searched.",
    }),
    "limit?": resultLimit,
    "snippetLines?": snippetLines,
  }),
  Search: type({
    workspace: fileInput.workspace,
    "scope?": scope,
    "includeTypes?": includeTypes,
    query: type("string >= 1").configure({
      description: "Natural-language behavior, concept, or code to find.",
    }),
    "limit?": resultLimit,
    "snippetLines?": snippetLines,
  }),
  Related: type({
    ...fileInput,
    "scope?": scope,
    "includeTypes?": includeTypes,
    line: type("number.integer >= 1")
      .pipe((line) => line - 1)
      .configure({
        description: "One-based source line from a search result or known location.",
      }),
    "limit?": resultLimit,
    "snippetLines?": snippetLines,
  }),
  Explore: type({
    ...exploreOptions,
    "position?": positionInput.describe(
      "Source position of the symbol, as a one-based { line, character }. Pass either this or symbol, not both.",
    ),
    "symbol?": type("string >= 1").describe(
      "Exact document-symbol name in the file. Pass either this or position, not both.",
    ),
  }),
  Investigate: type({
    workspace: fileInput.workspace,
    "scope?": scope,
    question: type("string >= 1").configure({
      description: "Implementation question or behavior to investigate.",
    }),
    "candidateLimit?": investigationResultLimit,
    "inspectionLimit?": investigationInspectionLimit,
    "relatedLimit?": investigationRelatedLimit,
    "relationshipLimit?": type("1 <= number.integer <= 100").configure({
      default: 4,
      description: "Maximum verified relationships shown per section (1-100).",
    }),
    "snippetLines?": investigationSnippetLines,
    "includeSource?": type("boolean").configure({
      default: false,
      description: "Include complete source for the inspected symbol or symbols.",
    }),
  }),
});

export const registerIntelligenceTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
  semble: Semble,
): void => {
  const intelligence = createRetrievalIntelligence({ semble, workspaces });
  const searchDependencies = createDependencySearch({ semble, workspaces });

  registerTool(
    server,
    "search_dependency_code",
    {
      title: "Search dependency code",
      description:
        "Search installed package code and its matching public runtime API without indexing all of node_modules. Use path for a known namespace or type for instance and chained methods. The importing file selects the exact package versions visible to that project.",
      inputSchema: input.DependencySearch,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace,
        file,
        package: packages,
        query,
        path = [],
        surface = "runtime",
        type,
        limit = 5,
        snippetLines = 10,
      },
      { mcpReq: { signal } },
    ) =>
      textResult(
        await searchDependencies({
          workspace,
          file,
          packages,
          query,
          path,
          surface,
          type,
          limit,
          snippetLines,
          signal,
        }),
      ),
  );

  registerTool(
    server,
    "search_code",
    {
      title: "Search code",
      description:
        "Find code by behavior or concept and anchor each match to an exact language-server symbol. Matching is semantic, not textual: this will not reliably locate an exact string literal, error message, or comment. Use workspace_symbols for an exact known name. Relevance is relative to the top result shown, so the first match is always 100%.",
      inputSchema: input.Search,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace, scope, includeTypes = false, query, limit = 5, snippetLines = 10 },
      { mcpReq: { signal } },
    ) =>
      textResult(
        await intelligence.search({
          root: workspace,
          scope,
          includeTypes,
          query,
          limit,
          snippetLines,
          signal,
        }),
      ),
  );

  registerTool(
    server,
    "related_code",
    {
      title: "Related code",
      description:
        "Find structurally similar code for a source line and anchor each match to an exact language-server symbol. Similarity is not a call, reference, or runtime relationship.",
      inputSchema: input.Related,
      annotations: readOnlyToolAnnotations,
    },
    async (
      { workspace, scope, includeTypes = false, file, line, limit = 5, snippetLines = 10 },
      { mcpReq: { signal } },
    ) =>
      textResult(
        await intelligence.findRelated({
          root: workspace,
          scope,
          includeTypes,
          file,
          line,
          limit,
          snippetLines,
          signal,
        }),
      ),
  );

  registerTool(
    server,
    "explore_symbol",
    {
      title: "Explore symbol",
      description:
        "Combine exact definitions, types, implementations, callers, calls, and references for one symbol with structurally similar code. Verified relationships and similarity are separate.",
      inputSchema: input.Explore,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace,
        file,
        scope,
        includeSource = false,
        includeTypeDefinitions = false,
        limit = 12,
        relatedLimit = 3,
        snippetLines = 6,
        ...target
      },
      { mcpReq: { signal } },
    ) =>
      textResult(
        await intelligence.exploreSymbol({
          root: workspace,
          scope,
          file,
          target: symbolTarget(target),
          includeSource,
          includeTypeDefinitions,
          limit,
          relatedLimit,
          snippetLines,
          signal,
        }),
      ),
  );

  registerTool(
    server,
    "investigate_code",
    {
      title: "Investigate code",
      description:
        "Retrieve ranked code for an implementation question and attach verified relationships to the exact identifier match or a bounded set of distinct candidates. Structural similarity is optional and remains separate.",
      inputSchema: input.Investigate,
      annotations: readOnlyToolAnnotations,
    },
    async (
      {
        workspace,
        scope,
        question,
        candidateLimit = 3,
        inspectionLimit = 2,
        relatedLimit = 0,
        relationshipLimit = 4,
        snippetLines = 6,
        includeSource = false,
      },
      { mcpReq: { signal } },
    ) =>
      textResult(
        await intelligence.investigate({
          root: workspace,
          scope,
          question,
          candidateLimit,
          inspectionLimit,
          relatedLimit,
          relationshipLimit,
          snippetLines,
          includeSource,
          signal,
        }),
      ),
  );
};
