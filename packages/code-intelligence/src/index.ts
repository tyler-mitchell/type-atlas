export {
  createVolarWorkspaces,
  type VolarWorkspace,
  type VolarWorkspacePool,
} from "./volar-workspace.ts";
export {
  createCodeIntelligence,
  type CodeIntelligence,
} from "./operations.ts";
export {
  listModuleExports,
  type ModuleExportPage,
  type ModuleExportSurface,
} from "./module-exports.ts";
export { page, projectDocumentSymbols } from "./projection.ts";
export {
  inspectSymbol,
  type InspectSymbolOptions,
  type InspectSymbolResult,
  type InspectSymbolTarget,
} from "./symbol-inspection.ts";
