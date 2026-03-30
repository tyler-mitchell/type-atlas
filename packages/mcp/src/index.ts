/**
 * Entry point for the FeatureType MCP server.
 *
 * Usage:
 *   featuretype-mcp [project-root]
 *
 * If project-root is omitted, uses the current working directory.
 */

import { startServer } from "./server.js";

const projectRoot = process.argv[2] ?? process.cwd();
startServer(projectRoot);
