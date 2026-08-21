<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `implementations`

Return implementation locations at a position.

## store interface

**Agent's Input**

```yaml
tool: Implementations
workspace: fixtures/ledger
file: packages/accounts/src/account.ts
position: {"line":31,"character":18}
# answered in under 1s
```

**Response**

~~~text
No implementation answered at this position. Implementations are reported for a symbol that something overrides or realises — an interface, an abstract member, an overload — and the walk reaches only files this session has opened, so an implementor in an untouched file reports nothing here. references finds every use, including the declarations that realise this.
~~~

## abstract parser

**Agent's Input**

```yaml
tool: Implementations
workspace: fixtures/ledger
file: packages/importers/src/statement-parser.ts
position: {"line":7,"character":23}
# answered in under 1s
```

**Response**

~~~text
StatementParser · implemented in 3 places

FixedWidthStatementParser · packages/importers/src/statement-parser.ts:41:14-41:39 · range 41:1-64:2
CsvStatementParser · packages/importers/src/statement-parser.ts:25:14-25:32 · range 25:1-35:2
StatementParser · packages/importers/src/statement-parser.ts:7:23-7:38 · range 7:1-23:2
~~~

