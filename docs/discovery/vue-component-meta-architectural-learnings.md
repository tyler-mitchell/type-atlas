# vue-component-meta Architectural Learnings

## Purpose

This document captures the architectural learnings from studying
`vue-component-meta` and related Vue language-tools surfaces.

This is a discovery and future-direction artifact, not a description of the
current FeatureType runtime. Current-state architecture lives in:

- `docs/implementation/mcp-architecture.md`
- `docs/implementation/mcp-navigation.md`

## Sources Studied

The findings below are based on these upstream implementation surfaces:

- `packages/component-meta/lib/checker.ts`
- `packages/component-meta/lib/types.ts`
- `packages/typescript-plugin/lib/requests/getComponentMeta.ts`

## Core Architectural Pattern

The most important pattern is:

1. create one canonical semantic environment
2. maintain that environment incrementally
3. resolve the real exported domain object
4. run a domain-specific extractor over canonical type information
5. return a compact structured semantic product

The differentiated value is not in generic navigation primitives. It is in
structured domain extraction layered on top of a real language-service
environment.

## Verified Learnings

### 1. One canonical semantic environment

`vue-component-meta` does not build a separate metadata parser or a second
semantic engine.

`checker.ts` creates:

- a Volar language layer
- a TypeScript language-service host
- a real TypeScript language service

All higher-level metadata extraction is derived from that canonical semantic
environment.

Architectural implication for this repo:

- if FeatureType grows richer semantic products, they should be derived from the
  canonical language-server / checker path
- they should not come from a second parser-only or MCP-only semantic path

### 2. Checker-style API is the right seam

`vue-component-meta` exposes a checker object with a small, reusable API:

- `getExportNames(...)`
- `getComponentMeta(...)`
- `updateFile(...)`
- `deleteFile(...)`
- `reload()`
- `clearCache()`
- `getProgram()`

This is a stronger seam than embedding all domain logic directly inside editor
features or transport adapters.

Architectural implication for this repo:

- domain intelligence should be expressed as a stable service or checker API
- the MCP layer can consume that API, but should not be the only place where it
  exists

### 3. Incremental snapshots are part of the architecture

The checker stores script snapshots and a project version in memory. Updates do
not recreate the whole world. They mutate the snapshot set and bump project
version.

That means:

- file-local change handling is incremental
- semantic state is long-lived
- the extractor is designed to sit on top of a reusable session

Architectural implication for this repo:

- a future semantic-extraction layer should sit on top of an incremental
  session/checker model
- re-bootstrap-per-request would be the wrong ownership seam for higher-value
  semantic products

### 4. Resolve the target first, then extract

`checker.ts` first resolves the exported symbol from the source file, then asks
the TypeScript checker for the type at that location, then passes that target
into `getComponentMeta(...)`.

`getComponentMeta.ts` in the Vue TypeScript plugin follows the same general
shape:

- find the target component
- resolve its canonical type
- pass the node and type into the extractor

Architectural implication for this repo:

- extraction should happen after canonical symbol and type resolution
- the extractor should not guess domain structure before semantic resolution

### 5. The product is a structured semantic object

`vue-component-meta` returns a domain model, not just raw protocol payloads.
The output includes structured component API information such as:

- props
- events
- slots
- exposed members
- descriptions
- defaults
- declarations
- schema-like type details

Architectural implication for this repo:

- if FeatureType is going to have a differentiated wedge, it is more likely to
  come from a structured semantic product than from generic navigation tooling

### 6. Package boundary separation is disciplined

The studied surfaces separate:

- project and checker construction
- type and symbol resolution
- domain extraction
- plugin-level request adaptation

The architectural value is not only the extractor itself. It is also the clean
boundary between semantic foundation and domain product.

Architectural implication for this repo:

- keep canonical semantics, MCP transport, and any future domain-extraction
  layer as separate owners

## What Transfers More Cleanly

The following ideas transfer more cleanly than a direct `.featuretype` analogy.

### Transferable pattern: canonical checker plus domain extractor

This repo can adopt the same shape where it actually fits:

- canonical semantic environment
- dedicated domain extractor
- compact structured output

The closest analogue is React or TSX component intelligence, not direct
`.featuretype` document metadata.

### Transferable pattern: reusable programmatic API

A future semantic-extraction layer should probably look like a small API
surface rather than a pile of ad hoc tools.

Possible shape:

- `createComponentMetaChecker(...)`
- `getComponentMeta(filePath, exportName?)`
- `updateFile(filePath, text)`
- `reload()`
- `getProgram()`

This is not a committed design. It is the cleanest transferable seam revealed
by the precedent.

### Transferable pattern: React component API extraction

The strongest parallel in this repo is a React-oriented semantic product that:

- resolves the exported component target
- asks the canonical checker for the real component type
- extracts a stable component API model

That model could eventually describe component-facing surfaces such as:

- props
- events or callback contracts
- slots or composition surfaces where applicable
- exposed members
- declarations and documentation
- schema-like summaries of component inputs

This is a much closer architectural analogue than treating `.featuretype`
documents themselves as the primary equivalent of Vue SFC component metadata.

## What Does Not Transfer Cleanly

Important non-transfers:

- Vue-specific taxonomy as implemented in Vue itself
- Vue plugin specifics such as SFC conventions
- treating component-meta as a generic code-navigation product
- assuming that the existence of a checker API means FeatureType should rebuild
  generic navigation around a new custom engine

The most important non-transfer is a one-to-one mapping between Vue component
metadata and `.featuretype` document structure. That analogy is too loose to be
architecturally reliable.

The precedent is valuable for differentiated semantic products, not for generic
navigation duplication.

## Architectural Decision Boundary

The clearest decision boundary this precedent reinforces is:

- for generic TS or JS navigation, stay thin and use the canonical
  language-server path
- for differentiated semantic products, add a dedicated extraction layer on top
  of that canonical path only where there is a real domain surface to extract
  from

This suggests that the repo should not try to win by rebuilding generic hover,
definition, references, or symbol tooling as a product.

It suggests that the repo can still win if it offers a structured semantic
artifact that generic LSP bridges do not provide.

## Implication For Future FeatureType Work

If the project wants a meaningful wedge beyond generic navigation, the most
promising path is:

1. keep the current canonical language-server architecture
2. keep the MCP layer thin for generic diagnostics and navigation
3. introduce a semantic extraction layer only when there is a clear domain
   product to expose, with React/component intelligence being the closer
   analogue to this precedent

That extraction layer should:

- depend on canonical semantic state
- be incremental or checker-backed
- expose a reusable API
- return structured domain output

## Current Unknowns

The precedent clarifies the seam, but it does not yet answer:

1. what the first differentiated semantic product should be
2. whether that extraction layer should live in a new package or in the current
   language-server package
3. whether the initial consumer should be MCP, tests, or another programmatic
   surface
4. whether the first worthwhile extraction target is React component API
   metadata, generated TSX surfaces, or something else entirely

## Practical Conclusion

The main architectural learning from `vue-component-meta` is not “build more
navigation.”

It is:

- keep one canonical semantic environment
- make domain extraction a first-class layer
- expose that extraction through a reusable checker-style API

That is the strongest differentiated direction revealed by the precedent.
