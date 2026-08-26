export {
  createVolarWorkspaces,
  type VolarWorkspace,
  type VolarWorkspacePool,
} from "./volar-workspace.ts";
export { createTypeAtlas, type TypeAtlas } from "./operations.ts";
export {
  listModuleExports,
  type ModuleExportPage,
  type ModuleExportSurface,
} from "./module-exports.ts";
export { page, projectDocumentSymbols } from "./projection.ts";
export {
  type CallSite,
  declarationAtPosition,
  declarationChainAtPosition,
  declarationsNamed,
  inspectSymbol,
  subjectAtPosition,
  type InspectSymbolOptions,
  type Located,
  type InspectSymbolResult,
  type InspectSymbolTarget,
} from "./symbol-inspection.ts";
export { renderComposition, renderDocument } from "./markdoc/render.ts";
export { codeFrame, divider, formatTime, noun, summaryRow, truncate } from "@type-atlas/atlascii";
export type { Row } from "@type-atlas/atlascii";
export { containingGitSubmodule, findGitSubmoduleRoots } from "./git-submodules.ts";
export {
  projectGraph,
  projectSources,
  type ProjectGraph,
  type ProjectSources,
} from "./project-graph.ts";
export {
  documentSymbols,
  foldingRanges,
  foldValueSymbols,
  readSourceView,
  type FoldedSymbol,
  type SourceView,
  type SourceWindow,
} from "./syntactic-features.ts";
export { takeRequestTraces } from "./language-server-process.ts";
export { requestCost, type RequestTrace, containsPosition } from "@type-atlas/atlascii";
