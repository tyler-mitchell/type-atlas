# MCP Case Study: 3d-sandbox-monorepo and three-blocks

## Summary

I used the MCP as part of a real implementation task in `~/Projects/3d-sandbox-monorepo`, specifically in the `supermarket-sim` sandbox where previous agents have struggled with the closed-source and lightly-documented `three-blocks` library.

The feature I implemented:

- added a `pathDebugMode` cycle for the supermarket sim pathfinding visuals
- keyboard control:
  - `D` still toggles diagnostics visibility
  - `P` now cycles path debug between `off`, `route`, and `full`
- wired the current mode into the existing `PathfindingHelper` so waypoint markers, destination marker, and body-line visibility can be changed without touching movement ownership

This was a good test because it required real library understanding, but the library knowledge had to come from local docs/examples rather than internet search or broad prior knowledge.

## Update After MCP Rebuild

After the MCP was rebuilt and Codex restarted, I reran the same `three-blocks` probes. The current state is materially better.

New capabilities confirmed in the rebuilt MCP:

- `list_projects`
- `attach_project`
- clearer semantic failure messages for out-of-root files

What changed in practice:

- before attaching `3d-sandbox-monorepo`, semantic queries on sibling-repo files now fail with an explicit explanation instead of a silent-looking miss:
  - file is outside the active project root
  - diagnostics may still work
  - semantic queries require the file to be in the TypeScript project graph
  - `attach_project` is suggested directly in the response
- after attaching `/Users/tylermitchell/Projects/3d-sandbox-monorepo`, the previously failing `three-blocks` probes started working

Successful `three-blocks` intellisense after `attach_project`:

- `get_definition` on import bindings now jumps into declaration files such as:
  - `@three-blocks/pro/dist/helpers/PathfindingHelper.d.ts`
  - `@three-blocks/pro/dist/pathfinding/PathfindingGrid.d.ts`
  - `@three-blocks/pro/dist/helpers/PathfindingGridHelper.d.ts`
  - `@three-blocks/pro/dist/core/Physics.d.ts`
  - `@three-blocks/pro/dist/core/PhysicsController.d.ts`
- `get_type_at` now returns meaningful hover-style type info and docstrings, for example:
  - `PathfindingHelper - 3D debug visualization for agent paths`
  - `PathfindingGrid - Defines the walkable area for pathfinding`
  - `Physics - Main physics engine API facade`
- `get_signature` now works at real call sites in the sandbox code, including:
  - `new PathfindingGrid(...)`
  - `new PathfindingHelper(...)`
  - `npcApi.body.navigation.enable(pathfindingGrid, ...)`
- `get_references` now returns real usage lists spanning both local sandbox code and the `three-blocks` declaration files
- `get_document_symbols` on the declaration files exposes the member surface well enough to discover properties and methods like:
  - `showWaypoints`
  - `showDestination`
  - `showBodyLine`
  - `update`
  - `dispose`
  - `compile`
  - `getGridData`

This is a major improvement over the earlier state. The MCP is now genuinely useful for exploring `three-blocks` in this repo instead of forcing a fallback to markdown docs and examples for almost everything.

Remaining sharp edges after the rebuild:

- project attachment is still a manual step
- signature help is still cursor-position sensitive
- the node_modules paths in results are correct but quite verbose

The biggest prior painpoints from this case study are now partially or fully addressed:

- opaque failure messages: fixed
- no intentional cross-repo workflow: improved via `attach_project`
- no practical `three-blocks` intellisense: fixed once the right project is attached

## Files Changed In The Case Study

In `3d-sandbox-monorepo`:

- `apps/playground/src/sandboxes/supermarket-sim/Scene.tsx`
- `apps/playground/src/sandboxes/supermarket-sim/components/SceneHud.tsx`
- `apps/playground/src/sandboxes/supermarket-sim/simulation/engine.ts`
- `apps/playground/src/sandboxes/supermarket-sim/simulation/types.ts`

## What The MCP Helped With

### 1. File-scoped diagnostics worked across repo boundaries

Even though the MCP session was rooted at the `featuretype` repo, I could still run `get_diagnostics` and `get_enriched_file` against the sibling repo by addressing files as relative paths such as:

- `../3d-sandbox-monorepo/apps/playground/src/sandboxes/supermarket-sim/Scene.tsx`

That let me do a real edit loop on the target files:

- inspect touched files before editing
- patch them
- call `notify_file_changed`
- rerun `get_diagnostics`

This was useful and practical.

### 2. `get_enriched_file` was still a good edit-safety tool

For the changed files, the enriched output gave me a compact "current full file with diagnostics inline" view after the patch. That made it easy to confirm that:

- the new callback/type wiring was coherent
- the scene state and HUD props matched
- the engine changes stayed clean

### 3. `notify_file_changed` worked as intended in the sibling repo case

After editing the four touched files, I called `notify_file_changed` on all of them and then reran diagnostics.

The MCP acknowledged all four updates and reported zero diagnostics on all four files afterward.

That means the post-edit refresh loop is not limited to the repo the MCP was originally launched from.

## Where The MCP Fell Short

### 1. Diagnostics worked, semantic queries mostly did not

This was the biggest cross-repo pain point.

In the sibling repo case:

- `get_diagnostics` worked
- `get_enriched_file` worked
- `notify_file_changed` worked

But these usually failed:

- `get_definition`
- `get_signature`
- `get_type_at`

I saw repeated `No definition found`, `No signature information`, and `No type information` responses on valid symbols inside the 3d-sandbox files.

So the MCP was useful as a diagnostics/refresh layer, but much weaker as a semantic navigation layer once the target repo did not match the server's original root.

### 2. This made the `three-blocks` discovery problem much harder than it should be

The case study was intentionally about `three-blocks`, where agents already struggle because:

- the library is closed source
- it is new
- there is very little internet context

The MCP did not meaningfully help me discover the library API shape in this sibling repo workflow.

I had to fall back to repo-local evidence:

- `threejs-blocks-docs/PathfindingHelper.md`
- `threejs-blocks-examples/physics_pathfinding.js`
- `threejs-blocks-examples/physics_rts.js`
- `threejs-blocks-examples/physics_towerdefense.js`

That evidence was good enough to ship the feature, but the MCP was not the main enabler for the library-understanding part. The local docs/examples were.

### 3. Direct `three-blocks` intellisense attempts were mostly empty

I explicitly used the MCP against `three-blocks` symbols in:

- `../3d-sandbox-monorepo/apps/playground/src/sandboxes/supermarket-sim/simulation/engine.ts`

Targets I probed:

- import bindings:
  - `PathfindingHelper`
  - `PathfindingGrid`
  - `PathfindingGridHelper`
  - `Physics`
- constructor/usage sites:
  - `new PathfindingGrid(...)`
  - `new PathfindingHelper(...)`
  - `npcApi.body.navigation.enable(pathfindingGrid, ...)`

Tool calls I used:

- `get_definition`
- `get_type_at`
- `get_signature`
- `get_references`

Observed results:

- import-site probes returned:
  - `No definition found`
  - `No type information`
  - `No references found`
- constructor-site probes returned:
  - `No definition found`
  - `No type information`
  - `No signature information`
- method-call probes returned:
  - `No signature information`

This was not a general MCP outage. In the same session, in-root probes inside the `featuretype` repo still worked. For example:

- `get_definition` on `packages/mcp/src/server.ts` resolved successfully to `packages/mcp/src/tools/diagnostics.ts`
- `get_type_at` on the same symbol returned a real TypeScript signature

So the practical conclusion is narrower and more useful:

- the MCP can be healthy
- the target sibling file can be readable
- diagnostics can still work
- but semantic intellisense on imported dependency symbols can still collapse to empty responses in that cross-repo setup

### 4. Relative-path cross-repo use is possible, but awkward and accidental-feeling

The fact that `../3d-sandbox-monorepo/...` worked for diagnostics is useful, but it does not feel like an intentional multi-project workflow.

Pain points:

- the file paths are awkward
- semantic behavior is inconsistent
- failures are ambiguous
- there is no explicit signal in the tool response about whether the file is outside the server's main project graph

This creates a half-working mode that is better than nothing, but not strong enough to rely on confidently.

## Why This Matters

This case study is different from the `.featuretype`-specific feedback:

- in the `featuretype` repo, the MCP was strongest on local TS implementation work but weak on custom-doc embedded semantics
- in the `3d-sandbox-monorepo` case, the MCP was strongest on cross-repo file diagnostics but weak on semantic discovery/navigation

That means the MCP currently has two different "partial success" modes:

1. In-root local project:
   - strong diagnostics
   - useful semantic navigation
   - custom-document gaps
2. Out-of-root sibling project:
   - diagnostics and refresh still usable
   - semantic navigation drops off sharply

## Highest-Value Improvements From This Case Study

### 1. Add an explicit project-root override or multi-root support

This is the most important improvement for cross-repo use.

Desirable outcomes:

- per-call `projectRoot`
- multiple configured roots
- or an MCP tool to switch/attach the active root

If that existed, the same live MCP could be repointed to `3d-sandbox-monorepo` intentionally instead of relying on relative path hacks.

### 2. Make semantic tools explain *why* they failed

Right now `No definition found` is too opaque.

Better failure information would distinguish:

- symbol genuinely unresolved
- file outside project graph
- file not part of tsconfig/program
- dependency types unavailable
- cursor not on a semantic token

This would save a lot of agent time.

### 3. Preserve diagnostics usefulness, but close the semantic gap

The cross-repo case proves the MCP can already do something valuable outside its original root.

The next step is to make these tools work together:

- `get_diagnostics`
- `get_enriched_file`
- `get_type_at`
- `get_definition`
- `get_signature`

If diagnostics work on a file, the semantic tools should ideally work too, or clearly explain why not.

### 4. Improve closed-source-library workflows

When internet lookup is weak and package source is opaque, agents need the MCP to be especially good at:

- local dependency type navigation
- constructor/property discovery
- symbol-to-doc/source jumping

This case study shows that repo-local markdown docs and examples are currently more reliable than the MCP for that part of the job when working outside the original project root.

## Bottom Line

The MCP did contribute to a real feature landing in `3d-sandbox-monorepo`, but mostly as a diagnostics-and-refresh tool, not as the main semantic understanding tool.

That distinction matters.

For this case study before the rebuild:

- the real implementation succeeded
- the MCP was useful in the edit loop
- the library-understanding work came mainly from local docs/examples
- the MCP's semantic queries were too weak in the sibling-repo setup to be the primary tool

After the rebuild, that last sentence is no longer hypothetical:

- cross-repo root handling is meaningfully better because `attach_project` exists
- semantic failure reporting is much better because failures explain the root mismatch directly
- once the sandbox project is attached, the MCP becomes genuinely useful for the exact "closed-source, lightly-documented library in a different repo" workflow that agents struggle with
