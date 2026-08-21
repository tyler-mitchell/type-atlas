<!-- Generated from the scenario captures by packages/mcp/scripts/render-docs.ts — edit the source, not this file. -->

# `compose`

Experimental: author your own code-intelligence answer as one markup document. You define all of it: self-closing ask tags declare the data and render nothing; the body you write is the entire answer, composing what the asks bind with the shipped tags and partials — {% $uses.total %}, {% tree entries=$uses.groups partial="reference-node.mdoc" /%}, headings, prose. Asks chain: a later ask reads an earlier answer, e.g. {% ask "diagnostics" as="health" files=$uses.paths /%} checks the files the reference search found. A document with no body renders nothing — the markup is yours, not the tool's.

Operations and what each binds:
- {% ask "hover" as="head" file="src/x.ts" line=5 character=10 /%} (one-based, on the symbol's name) → {text}: the signature and documentation, rendered with {% $head.text %}
- {% ask "references" as="uses" file="src/x.ts" line=5 character=10 /%} → {total, files, paths, projects, groups}; render sites with {% tree entries=$uses.groups partial="reference-node.mdoc" /%}
- {% ask "outline" as="shape" file="src/x.ts" /%} → {total, tree}; render with {% tree entries=$shape.tree partial="symbol-node.mdoc" /%}
- {% ask "diagnostics" as="problems" file="src/x.ts" /%} → {total, groups}; render with {% each items=$problems.groups as="group" partial="diagnostic-group.mdoc" /%}
- {% ask "source" as="body" file="src/x.ts" from=10 to=40 /%} → {lines, startLine}; render with {% source lines=$body.lines startLine=$body.startLine /%}
- {% ask "occurrences" as="hits" text="device.lost" file="src" /%} (file is the directory to scan) → {total, fileCount, scanned, groups}: every place the exact text occurs, or an honest zero with the scan count
- {% ask "subject" as="what" file="src/x.ts" line=5 character=10 /%} → {name, kind, file, at}: what the position resolves to, and where it is declared
- {% ask "callers" as="calledBy" file="src/x.ts" line=5 character=10 /%} → {name, total, projects, groups}; render with {% tree entries=$calledBy.groups partial="call-node.mdoc" /%}

One ask failing binds {failed} and is stated in a feedback line under your answer; the rest of the composition still answers.

## settlement dossier

**Agent's Input**

```yaml
tool: Compose
workspace: fixtures/ledger
document: {% ask "subject" as="what" file="packages/accounts/src/posting.ts" line=25 character=14 /%}
{% ask "references" as="uses" file="packages/accounts/src/posting.ts" line=25 character=14 /%}
{% ask "diagnostics" as="health" file="packages/accounts/src/posting.ts" /%}

## {% $what.name %} · {% $what.file %}:{% $what.at %}

{% $uses.total %} uses across {% $uses.files %} files · {% $health.total %} problems in the declaring file

{% tree entries=$uses.groups partial="reference-node.mdoc" /%}
# answered in under 1s
```

**Response**

~~~text
## signedAmount · packages/accounts/src/posting.ts:25:14

10 uses across 6 files · 0 problems in the declaring file

packages/accounts/src/index.ts
└  12:39 — at module level
packages/accounts/src/journal.ts
├  3:39  — at module level
└  52:12 — inside post
packages/accounts/src/posting.ts
└  25:14 — at module level
packages/reconcile/src/drift.ts
├  4:24  — at module level
└  20:37 — inside journalTotal
packages/reports/src/balance.ts
├  6:3   — at module level
└  34:57 — inside balancesAsOf
packages/rules/src/builtin.ts
├  1:10  — at module level
└  26:12 — inside closedPeriodsBalance
~~~

