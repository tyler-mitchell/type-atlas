<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `code_actions`

Discover quick fixes and refactors for a range, or resolve a displayed action to a Codex patch. Stable source-wide actions have dedicated tools. The MCP does not modify files.

## at a type error

**Agent's Input**

```yaml
tool: Code actions
workspace: fixtures/ledger
file: packages/reconcile/src/drift.ts
range: {"start":{"line":21,"character":65},"end":{"line":21,"character":70}}

# answered in 23ms
```

**Response**

~~~text
packages/reconcile/src/drift.ts:21:65-21:70 · 5 actions

1. Extract to constant in module scope [refactor.extract.constant]
2. Extract to constant in enclosing scope [refactor.extract.constant]
3. Extract to function in module scope [refactor.extract.function]
4. Extract to inner function in arrow function [refactor.extract.function]
5. Move to a new file [refactor.move.newFile]

1 problem at this position
~~~

