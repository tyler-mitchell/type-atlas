<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `impact`

Experimental: weigh a change to the symbol at a position — every use, grouped by package, with how many sit in tests. Loads the projects of consumers retrieval can see, so the answer reaches past what this session happened to touch. Composed for the decision, not the enumeration; references lists the sites themselves.

## weigh a change to signed amount

```yaml
tool: Impact
workspace: fixtures/ledger
file: packages/accounts/src/posting.ts
position: {"line":25,"character":14}
```

~~~text
Changing signedAmount touches 10 uses in 6 files across 4 packages, in the projects loaded this session. No use sits in a test file.

packages/accounts   4  3
packages/reports    2  1
packages/reconcile  2  1
packages/rules      2  1

Retrieval also names packages/importers — not loaded and not confirmed as uses, so they are outside this count. Reading a file in one loads its project, and asking again weighs it.
~~~

## weigh a change to a shared type

```yaml
tool: Impact
workspace: fixtures/ledger
file: packages/money/src/money.ts
position: {"line":12,"character":13}
```

~~~text
Changing Money touches 38 uses in 9 files across 5 packages, in the projects loaded this session. 4 of the uses sit in test files.

packages/money      16  3  4
packages/accounts   10  2
packages/reports     7  2
packages/rules       3  1
packages/reconcile   2  1
~~~

