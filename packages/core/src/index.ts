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
  readSourceView,
  type SourceView,
  type SourceWindow,
} from "./source-view.ts";
export {
  type CallSite,
  formatSymbolInspection,
  inspectSymbol,
  type InspectSymbolOptions,
  type InspectSymbolResult,
  type InspectSymbolTarget,
} from "./symbol-inspection.ts";
export { containingGitSubmodule, findGitSubmoduleRoots } from "./git-submodules.ts";
export { documentSymbols, foldingRanges } from "./syntactic-features.ts";
