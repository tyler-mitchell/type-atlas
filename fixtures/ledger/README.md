# ledger

A deliberately realistic TypeScript monorepo that Type Atlas tools are
exercised against. It is the workspace behind every captured scenario response
in `packages/mcp/test/scenarios/` — fixture, scenario definitions, and
committed responses form one pipeline:

```text
realistic fixture scenario
→ actual Type Atlas tool invocation
→ captured response
→ internal snapshot / regression use
→ derived documentation example
```

The domain is double-entry bookkeeping: branded primitives (`Money`),
discriminated unions (`Posting`), generics with overloads (`Journal.post`),
interface/implementation splits (`AccountStore` / `MemoryAccountStore`), and
real cross-package type flow (`reports` consumes `accounts` consumes `money`).

Rules for changing this fixture:

- It is a standalone Vite+ workspace, scaffolded with `vp create
  vite:monorepo`. It is **not** part of the repository's workspace, lint, or
  typecheck surface, because parts of it are broken on purpose:
  `packages/reconcile` carries deliberate type errors that diagnostics
  scenarios capture. Never "fix" them without regenerating the responses.
- Every file must be owned by a package `tsconfig.json` — an unowned file is
  a server-crash scenario, not a fixture.
- Changing any file here changes captured responses. Regenerate with the
  scenario suite in `@type-atlas/mcp` (`vitest -u` to accept) and review the
  response diffs like code.
