<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `selection_ranges`

Return the nested structural ranges an editor expands through from one or more source positions.

## expression to file

**Agent's Input**

```yaml
tool: Selection ranges
workspace: fixtures/ledger
file: packages/reports/src/balance.ts
position: {"line":34,"character":20}
# answered in 3ms
```

**Response**

~~~text
packages/reports/src/balance.ts · 1 position expands through 19 ranges · each contains the one above it

34:20
└  34:17-34:20
   └  34:13-34:20
      └  34:13-34:37
         └  34:13-34:55
            └  34:13-34:78
               └  34:9-34:79
                  └  32:15-35:7
                     └  32:7-35:8
                        └  32:7-35:9
                           └  31:44-36:5
                              └  31:5-36:6
                                 └  29:33-37:3
                                    └  29:3-37:4
                                       └  27:31-51:1
                                          └  27:30-51:2
                                             └  23:29-51:2
                                                └  23:1-51:3
                                                   └  18:1-51:3
                                                      └  1:1-59:1
~~~

