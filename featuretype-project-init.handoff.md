# FeatureType Project Init Handoff

## What This Repo Is

FeatureType is being started as its own standalone project because the idea is now large enough, broad enough, and open-ended enough that it should not inherit the constraints of an existing product repo.

This repository is intentionally only a fresh project shell plus this handoff. It should be treated as a new beginning, not as a continuation of prior implementation momentum.

## Why This Exists

The project exists to explore a new kind of product and developer tooling surface around reusable knowledge, discoverability, and shared understanding of how things in a codebase should be used.

At a high level, the opportunity is to create something that helps close the gap between:

- what exists in a codebase
- how humans understand and communicate it
- how agents discover and use it

The specific shape of that solution is still open.

## Current State

This repo has been initialized as a minimal Turborepo monorepo with PNPM.

At the moment it contains:

- a bare Turborepo root
- a workspace definition for `apps/*` and `packages/*`
- an installed dependency baseline for Turbo and TypeScript
- no product code
- no application choice
- no package strategy
- no architecture commitments

That sparseness is intentional.

## Important Framing For The Next Agent

This project should begin from first principles.

Do not assume that previous explorations, plans, drafts, or repo-local patterns from other projects should define the implementation here. They may be useful as background context, but they are not the source of truth for this project.

The next agent should feel free to:

- question the problem framing
- redefine the product boundaries
- choose a different vocabulary if needed
- reshape the scope before any substantive buildout

The main thing to preserve is the ambition of the project, not the specific structure of earlier ideas.

## What Should Stay Open

The following should remain intentionally undecided at the start:

- the exact product form
- the primary user journey
- the right abstraction level
- the architecture
- the file or data model
- the editor or runtime strategy
- the packaging strategy
- the branding and naming details beyond the working project name

The next agent should earn those decisions through discovery and shaping rather than inherit them.

## High-Level Project Intent

FeatureType should be approached as a project about shared understanding.

That may include one or more of the following themes, but none of them should be treated as mandatory commitments yet:

- better discoverability of reusable things
- clearer guidance around correct usage
- stronger bridges between human-facing and agent-facing understanding
- more truthful project knowledge that stays close to reality
- a better experience for exploring, learning, and working with composable systems

Those themes are the signal. The implementation path is still open.

## Illustrative `.featuretype` Examples

It is fine for the next agent to explore the project through concrete examples, including examples of what a `.featuretype` file might look like.

These examples should be treated as prompts for thinking and discussion, not as a locked contract.

### Example: simple component usage

```tsx
<intent>
  Button for primary and secondary action triggers.
</intent>

<examples>
  <example id="default">
    <Button>Save</Button>
  </example>

  <example id="destructive">
    <Button tone="destructive">Delete</Button>
  </example>

  <example id="loading">
    <Button loading>Saving…</Button>
  </example>
</examples>

<notes>
  Useful when the goal is to show common ways a button appears and behaves.
</notes>
```

### Example: pattern or workflow usage

```tsx
<intent>
  Search toolbar that combines query input, filters, and sort controls.
</intent>

<anatomy>
  SearchToolbar
    > QueryInput
    > FilterGroup
    > SortSelect
</anatomy>

<examples>
  <example id="compact-list-page">
    <SearchToolbar mode="compact" />
  </example>

  <example id="expanded-advanced">
    <SearchToolbar mode="expanded" showAdvancedFilters />
  </example>
</examples>

<notes>
  Useful if FeatureType ends up covering composed patterns, not just isolated primitives.
</notes>
```

### Example: agent-facing understanding

```tsx
<intent>
  Single-select combobox for choosing one option from a controlled list.
</intent>

<guidance>
  Caller provides the current value, change handler, and options.
</guidance>

<examples>
  <example id="minimal-controlled">
    <SingleSelectCombobox
      value={sort}
      onValueChange={setSort}
      options={SORT_OPTIONS}
    />
  </example>

  <example id="toolbar-filter">
    <RepoToolbarSelect
      value={sort}
      onValueChange={setSort}
    />
  </example>
</examples>

<anti-patterns>
  Do not use this for multi-select behavior.
</anti-patterns>

<related>
  multi-select-combobox
  repo-toolbar-select
</related>
```

These examples are valuable because they show the kind of understanding the project may want to capture, while still leaving fully open:

- how `.featuretype` files are authored
- how much structure they require
- whether they are primarily human-facing, agent-facing, or both
- how they connect to any future tooling

## Success Criteria For The Early Stage

In the near term, success is not “shipping the full system.”

Success is:

- clarifying what problem FeatureType is actually solving
- identifying who it is most valuable for first
- understanding what should be in scope versus deferred
- creating enough conceptual clarity that implementation choices become obvious instead of premature

If the next agent can produce a sharper project definition and a better shared language for talking about the opportunity, that is meaningful progress.

## Constraints For This Handoff

This handoff is intentionally non-prescriptive.

It does not specify:

- architecture
- package layout
- framework choices
- runtime choices
- implementation phases
- technical contracts
- migration strategy from any prior system

If a future document starts prescribing those things, it should do so only after fresh discovery in this repo.

## Suggested Starting Posture

The best starting posture for the next agent is:

- begin with project shaping rather than implementation
- prefer clarification over momentum theater
- separate durable goals from accidental assumptions
- treat all earlier ideation as optional input, not inherited obligation

This repo should become whatever the project actually needs, not whatever prior explorations happened to sketch first.

## Final Note

The most important context to carry forward is simple:

FeatureType deserves to be its own project, and it deserves the freedom to define itself on its own terms.
