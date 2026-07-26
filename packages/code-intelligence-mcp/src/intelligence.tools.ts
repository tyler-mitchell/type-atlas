import type { VolarWorkspacePool } from "@featuretype/code-intelligence";
import type { McpServer } from "@modelcontextprotocol/server";
import { type } from "arktype";
import { createRetrievalIntelligence } from "./intelligence.ts";
import { readOnlyToolAnnotations } from "./metadata.ts";
import { textResult } from "./mcp-result.ts";
import type { Semble } from "./semble.ts";
import { fileInput } from "./tool-input.ts";
import { positionInput } from "./tool-input.ts";

const resultLimit = type("1 <= number.integer <= 20").configure({
  default: 5,
  description: "Maximum retrieval matches returned.",
});

const snippetLines = type("null | 0 <= number.integer <= 30").configure({
  default: 10,
  description:
    "Source lines included for each retrieval match; pass null for the complete chunk.",
});

const investigationResultLimit = type("1 <= number.integer <= 20").configure({
  default: 3,
  description: "Maximum retrieval matches returned.",
});

const investigationSnippetLines = type(
  "null | 0 <= number.integer <= 30",
).configure({
  default: 6,
  description:
    "Source lines included for each retrieval match; pass null for the complete chunk.",
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
    description: "Maximum verified relationships shown per section.",
  }),
  "relatedLimit?": investigationResultLimit,
  "snippetLines?": investigationSnippetLines,
} as const;

const input = type.module({
  Search: type({
    workspace: fileInput.workspace,
    "scope?": scope,
    "includeTypes?": includeTypes,
    query: type("string >= 1").configure({
      description: "Natural-language behavior, concept, or code to find.",
    }),
    "limit?": resultLimit,
    "snippetLines?": snippetLines,
  }).onUndeclaredKey("reject"),
  Related: type({
    ...fileInput,
    "scope?": scope,
    "includeTypes?": includeTypes,
    line: type("number.integer >= 0").configure({
      description: "Zero-based source line from a search result or known location.",
    }),
    "limit?": resultLimit,
    "snippetLines?": snippetLines,
  }).onUndeclaredKey("reject"),
  Explore: type({
    ...exploreOptions,
    position: positionInput,
  }).onUndeclaredKey("reject").or(type({
    ...exploreOptions,
    symbol: type("string >= 1").configure({
      description: "Exact document-symbol name in the file.",
    }),
  }).onUndeclaredKey("reject")),
  Investigate: type({
    workspace: fileInput.workspace,
    "scope?": scope,
    question: type("string >= 1").configure({
      description: "Implementation question or behavior to investigate.",
    }),
    "candidateLimit?": investigationResultLimit,
    "relatedLimit?": investigationResultLimit,
    "relationshipLimit?": type("1 <= number.integer <= 100").configure({
      default: 8,
      description: "Maximum verified relationships shown per section.",
    }),
    "snippetLines?": investigationSnippetLines,
    "includeSource?": type("boolean").configure({
      default: false,
      description: "Include the complete primary symbol body.",
    }),
  }).onUndeclaredKey("reject"),
});

export const registerIntelligenceTools = (
  server: McpServer,
  workspaces: VolarWorkspacePool,
  semble: Semble,
): void => {
  const intelligence = createRetrievalIntelligence({ semble, workspaces });

  server.registerTool(
    "search_code",
    {
      title: "Search code",
      description:
        "Find code by behavior, concept, or identifier and anchor each match to an exact language-server symbol. Use workspace_symbols for an exact known name.",
      inputSchema: input.Search,
      annotations: readOnlyToolAnnotations,
    },
    async ({
      workspace,
      scope,
      includeTypes = false,
      query,
      limit = 5,
      snippetLines = 10,
    }, { mcpReq: { signal } }) =>
      textResult(await intelligence.search({
        root: workspace,
        scope,
        includeTypes,
        query,
        limit,
        snippetLines,
        signal,
      })),
  );

  server.registerTool(
    "related_code",
    {
      title: "Related code",
      description:
        "Find structurally similar code for a source line and anchor each match to an exact language-server symbol. Similarity is not a call, reference, or runtime relationship.",
      inputSchema: input.Related,
      annotations: readOnlyToolAnnotations,
    },
    async ({
      workspace,
      scope,
      includeTypes = false,
      file,
      line,
      limit = 5,
      snippetLines = 10,
    }, { mcpReq: { signal } }) =>
      textResult(await intelligence.findRelated({
        root: workspace,
        scope,
        includeTypes,
        file,
        line,
        limit,
        snippetLines,
        signal,
      })),
  );

  server.registerTool(
    "explore_symbol",
    {
      title: "Explore symbol",
      description:
        "Combine exact definitions, types, implementations, callers, calls, and references for one symbol with structurally similar code. Verified relationships and similarity are separate.",
      inputSchema: input.Explore,
      annotations: readOnlyToolAnnotations,
    },
    async ({
      workspace,
      file,
      scope,
      includeSource = false,
      includeTypeDefinitions = false,
      limit = 12,
      relatedLimit = 3,
      snippetLines = 6,
      ...target
    }, { mcpReq: { signal } }) =>
      textResult(await intelligence.exploreSymbol({
        root: workspace,
        scope,
        file,
        target: "symbol" in target
          ? { symbol: target.symbol }
          : { position: target.position },
        includeSource,
        includeTypeDefinitions,
        limit,
        relatedLimit,
        snippetLines,
        signal,
      })),
  );

  server.registerTool(
    "investigate_code",
    {
      title: "Investigate code",
      description:
        "Retrieve code for an implementation question, inspect the primary symbol's verified relationships, and find related code from the question-specific match. Verified relationships and similarity are separate.",
      inputSchema: input.Investigate,
      annotations: readOnlyToolAnnotations,
    },
    async ({
      workspace,
      scope,
      question,
      candidateLimit = 3,
      relatedLimit = 3,
      relationshipLimit = 8,
      snippetLines = 6,
      includeSource = false,
    }, { mcpReq: { signal } }) =>
      textResult(await intelligence.investigate({
        root: workspace,
        scope,
        question,
        candidateLimit,
        relatedLimit,
        relationshipLimit,
        snippetLines,
        includeSource,
        signal,
      })),
  );
};
