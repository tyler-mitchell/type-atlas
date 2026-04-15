# MCP Validation Modes

## Purpose

This document defines the current validation modes for FeatureType MCP and the
names we should use for them.

The goal is to keep one simple distinction clear:

- `direct/session-attached MCP` means the FeatureType MCP exposed to the
  current Codex session as first-class MCP tools
- everything else is not that

## Official Modes

### Direct Session-Attached MCP

This is the mode users usually mean when they say:

- "use the live MCP"
- "use the actual MCP"
- "use the direct MCP"

Properties:

- the MCP is attached to the current Codex session
- tool calls appear as first-class MCP tool usage in the session
- this is the right manual acceptance path for real agent usage

This mode is not provided by a repo script. It depends on session/tooling
attachment outside the repo.

### In-Memory Probe

Script:

- `pnpm --filter @featuretype/mcp probe:in-memory`

Properties:

- connects a local MCP client to `createMcpRuntime(...)` through
  `InMemoryTransport`
- validates MCP runtime and tool behavior without stdio or process-boundary
  overhead
- is the main automated validation lane for repo tests

### Stdio Probe

Script:

- `pnpm --filter @featuretype/mcp probe:stdio`

Properties:

- starts the MCP server through the repo's stdio source entrypoint
- validates child-process startup and stdio transport wiring
- should stay small and boundary-focused

## Server Entrypoints

Root-level scripts:

- `pnpm mcp:stdio:source`
- `pnpm mcp:stdio:dist`

These are server entrypoints, not validation modes by themselves.

## Not Official Modes

These may still be useful for debugging, but they are not official validation
mechanisms and should not be described as if they were:

- `js_repl` orchestration
- shell-launched ad hoc stdio clients
- temporary Node scripts that talk to the MCP server out of band

## Current Gap

The repo currently has an automated stdio probe for the source server path.

It does not yet have a dedicated automated probe for the packaged/dist stdio
entrypoint. That is a real gap, but it is separate from the direct
session-attached MCP flow.
