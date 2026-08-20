<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `type_definitions`

Return type-definition locations at a position.

## parameter to branded type

```yaml
tool: Type definitions
workspace: fixtures/ledger
file: packages/reports/src/statement.ts
position: {"line":8,"character":49}
```

~~~text
balance [parameter] · type declared at 1 target

Money · packages/money/src/money.ts:12:21-16:2
~~~

## call result to alias

```yaml
tool: Type definitions
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
position: {"line":33,"character":20}
```

~~~text
Nothing at this position has a type declared elsewhere. A primitive, a literal, or an inferred anonymous shape has no type definition to jump to.
~~~

## parameter to mapped type

```yaml
tool: Type definitions
workspace: fixtures/ledger
file: packages/rules/src/rule.ts
position: {"line":47,"character":3}
```

~~~text
book [parameter] · type declared at 1 target

RuleBook · packages/rules/src/rule.ts:41:31-43:2
~~~

