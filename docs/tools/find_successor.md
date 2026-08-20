<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `find_successor`

Establish what happened to a symbol that no longer resolves: whether it still exists somewhere, or was withdrawn, and what currently occupies its role. Use this before concluding a capability is gone — a name that returns nothing from search is the case this answers, not evidence of removal.

## renamed method hunch

```yaml
tool: Find successor
workspace: fixtures/ledger
file: packages/accounts/src/journal.ts
name: postEntry
```

~~~text
Not found · postEntry · no declaration of this name is in the symbol index

Searched symbols declared in loaded projects, the semantic index. Only projects opened this session are searched, so a name declared in a project nothing has touched reports nothing here — ask something semantic about a file in that project, then ask this again. This states what the index holds, not what the repository contains: an absent declaration is evidence, and references or document_symbols on a file you suspect will confirm or contradict it.

Candidates (4)

entry · declared in a loaded project · shares entry · packages/accounts/src/journal.ts
Entry · declared in a loaded project · shares entry · packages/accounts/src/journal.ts
UnbalancedEntryError · declared in a loaded project · shares entry · packages/accounts/src/journal.ts
entry:recorded · declared in a loaded project · shares entry · packages/rules/src/rule.ts

Files discussing it (5)

packages/accounts/src/posting.ts
packages/accounts/src/journal.ts
packages/rules/src/builtin.ts
packages/reports/src/balance.ts
packages/rules/src/rule.ts

A file naming something the index does not declare is either discussing it from outside — a comment, a document, an import of someone else's — or declaring it in a project the index has not read. Read one before concluding which.

A candidate is a lead, not a verdict. Confirm one by reading it before treating this capability as replaced, and treat an empty candidate list as evidence the capability was withdrawn rather than renamed.
~~~

## close miss finds the successor

```yaml
tool: Find successor
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
name: balanceOf
```

~~~text
Not found · balanceOf · no declaration of this name is in the symbol index

Searched symbols declared in loaded projects, the semantic index. Only projects opened this session are searched, so a name declared in a project nothing has touched reports nothing here — ask something semantic about a file in that project, then ask this again. This states what the index holds, not what the repository contains: an absent declaration is evidence, and references or document_symbols on a file you suspect will confirm or contradict it.

Candidates (5)

balance · declared in a loaded project · shares balance · packages/reports/src/balance.ts
balancesAsOf · declared in a loaded project · shares of · packages/reports/src/balance.ts
BalanceLine · declared in a loaded project · shares balance · packages/reports/src/balance.ts
normalBalance · declared in a loaded project · shares balance · packages/accounts/src/account.ts
closedPeriodsBalance · declared in a loaded project · shares balance · packages/rules/src/builtin.ts

Files discussing it (5)

packages/reports/src/balance.ts
packages/accounts/src/account.ts
packages/reports/src/balance.ts
packages/reports/src/index.ts
packages/accounts/src/journal.ts

A file naming something the index does not declare is either discussing it from outside — a comment, a document, an import of someone else's — or declaring it in a project the index has not read. Read one before concluding which.

A candidate is a lead, not a verdict. Confirm one by reading it before treating this capability as replaced, and treat an empty candidate list as evidence the capability was withdrawn rather than renamed.
~~~

