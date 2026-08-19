---
name: usage-first-mcp-development
description: How to develop Type Atlas. You build the instrument you perceive through, so the work is driven by your own genuine need to understand something — and the instrument's failures to answer you are the design input.
---

# Usage-First MCP Development

## The work

You are trying to understand a codebase. Really trying — there is something you
need to know to make the next change correctly, and you do not know it yet.

The instrument you use to find out is the one you are building.

That is the whole method. Not a process to execute: a situation to be in. Do real
work, need real answers, and pay attention to what happens when you ask.

An agent that treats this as a task sheet produces exactly what a task sheet
produces — locally valid changes, no design, and a tool that nobody can think
with. The rails at the end of this document are cheap insurance against specific
expensive mistakes. They are not the point, they are not the shape of the work,
and narrating them is worse than useless. Follow them invisibly.

---

## What "good" means here

The product is not a function call. It is **the answer an agent receives and has
to act on**.

So the bar is ergonomic, and it is answered by imagining a competent agent that
did not write any of this:

> They asked a question because they were stuck. Does this answer unstick them,
> or do they now have to open a file, ask again with different arguments, or
> guess?

An answer that is correct and leaves them stuck has failed. Every reformulation
they are forced into is a defect you caused.

Everywhere else you have worked, your tools were trustworthy and the code was
suspect. Here the tool *is* the code, and a malformed answer does not announce
itself — it arrives looking like an answer and you act on it. Which is why:
source, types, and tests say what the code *says*; only a call says what an agent
*receives*. Claims about behaviour need a call behind them.

One boundary on that rule, learned the hard way. It governs the MCP surface —
what an agent receives. For the substrate beneath it — Volar, TypeScript, the
bridge — the repo's recorded evidence outranks your live probe:
`docs/volar-affordance-evidence.md` says what was true, and instrumentation
only says what changed. A substrate diagnosis built from probes alone was
confidently wrong here for ten days, while the observation contradicting it
sat unread in the ledger the whole time. Read the ledger first, and when it
disagrees with a live call, you have found a change, not a refutation.

**Probes are banned — no exceptions, and no value.** Never scaffold a raw
language service, temp project, or scratch script to interrogate the
substrate; that genre was banned here after repeated drift, and a "quick
platform check" is how it returns. The reloading MCP is the exact interface
an agent meets in production, so a probe can only measure something no agent
will ever experience — the moment a probe feels necessary, the need it would
serve is not practical, and the practical move has been lost sight of. The
loop is: make the change, reload, call the tool, read the answer. A stdio
test that witnesses a tool's real answer is the one sanctioned test shape; a
test that builds its own `ts.createLanguageService` is a probe wearing a
test's name. When the surface cannot show you something, either the surface
should show it — build that — or the thing was never needed.

---

## Reading what comes back

**You read a result for the thing you asked about, and that intent blinds you to
the rest.** A heading contradicting its own rows, a count that does not match its
list, a value that identifies nothing — all of it sits in plain sight while you
extract the one field you wanted. The defects that survive longest are the ones
obvious to anyone reading *without* your intent.

So read the whole result as if you had not asked the question. "I was looking for
something else" is not a defence.

This binds hardest on calls made in passing. A result you only consumed as a
stepping stone — a hover on the way to an edit, an ambient block under an
answer you wanted for something else — still gets the floor, because those are
the answers nobody ever reads deliberately, so their defects live longest. A
diagnostics block was consumed twice in one session, used successfully both
times, while its rows named no referent at all — bare positions a reader must
open a file to decode — and the person watching caught it before the session
did. Every located row names what stands there; a tool answer that shows a
position without its owner has broken the surface's own location grammar, and
noticing that is not the asker's job.

Three kinds of coherence fail independently, and passing one tells you nothing
about the others:

**Internal** — does this answer contradict itself? Heading against body, summary
against detail, a claimed scope against what is shown.

**Lateral** — does it agree with its siblings? A tool answering in prose with
named owners while its neighbours answer in bare coordinates is a defect *even
when its own output is flawless*. Reading one answer carefully will never reveal
this. It only gets caught if you deliberately look across.

**Ground** — does it match reality? When a position or a count is about to carry
weight in your next decision, check it against the file. Not always. Whenever it
matters.

And whatever else a result contains: damage you caused is yours, and it is fixed
before the work you were doing — never filed as a note, never mentioned to the
user *instead of* being fixed.

### Gates, not checklists

These are not the same thing and confusing them ruins the work.

A **checklist** is a sequence of steps you tick off and report. It becomes the
work: the agent optimises for having completed the steps, narrates them for
credit, and stops thinking. Anything that produces a block of labelled lines in
your output is a checklist, whatever it is called.

A **coherency gate** is a condition that has to hold for the work to be right. It
is invisible. You hold it while looking at something, and it changes what you
do — you notice the count disagrees with the list, so you fix it. Nobody is told
that a gate was applied, because the evidence of a gate is the defect that isn't
there.

A gate is also not a small question. Ticking "does the count match the list" is
still mechanical — it is a checklist item wearing a gate's name. Real gates are
systems-level and they are uncomfortable, because a truthful answer can invalidate
the work you have already done and the belief you formed an hour ago.

Gates are procedural in the sense that matters: there is a floor that runs every
single time, on every response, whether or not you expect a problem. Skipping it
because a response "looks fine" is how a wrong value survives in every call for
half an hour. What is forbidden is *narrating* it, and stopping at it.

**These questions are the procedure.** They replace step-lists entirely — there is
nothing else to tick.

But a gate posed on every trivial read is noise, and noise is how a gate stops
being answered honestly. They fire where the answer can still change what you do:

- *A result you are about to act on* — correctness, coherence, what is missing.
- *A result that came back empty* — the absence question, before you believe it.
- *Before an edit* — is this useful or is it motion; is there a simpler way; does
  the framework already provide this.
- *After changing a tool* — have you seen its other branches, not just the one you
  built for.

Elsewhere, read and move on.

- **Is everything here correct, coherent, and intuitively presented?** All three,
  as one question. Correct and incoherent is still broken — the same word meaning
  two different things in one answer, `3 shown` in a header above `6 shown` in its
  own page line.
- **Is there information that would be particularly useful and is simply missing?**
  Not "is it wrong" — what would a reader need that is not here. A position with
  no owner, a count with no subject, a file that never said which file, a list of
  18 that shows 8 without saying so.
- **Is anything about this unclear?** If you have to pause and work out what a
  field means, so will every agent after you, and they will not have your context.
- **Is this token-efficient while still showing the most useful thing?** Both
  halves. Padding costs the reader; brevity that drops the useful part costs them
  more. A path repeated on forty rows and a bare `40:10` are the same defect from
  opposite directions.

- **If this answered with an absence, have I seen it answer with a presence?**
  An empty result and a broken tool are the same text. Before believing any
  "none", "not found", or "(0)", run the same tool on something that must
  answer — a symbol you can see declared, a file you know imports it. If the
  presence case also comes back empty, the absence was never about your question.
  This is how a reverse-lookup API that returns nothing without searching was
  found to be unimplemented rather than correct.
- **Have I actually seen this tool's other answers?** One response is one branch.
  A tool has a found case and an empty one, one item and many, a page and a whole,
  a bounded window and a whole file, a symbol that is ambiguous and one that is
  not. Judging a tool from the single shape you happened to ask for is how a
  single-file read shipped with no filename while the two-file case looked fine.
  Go and produce the other shapes deliberately; do not wait to meet them.
- **Does anything here contradict anything else here?** A heading against its
  rows, a count against its list, a scope against what is shown.
- **If this reported nothing, do I know which nothing?** Empty because there is
  nothing, or empty because nothing was asked — they render identically.

That floor is the minimum, not the ceiling, and a fixed list treated as complete
becomes the checklist this section exists to prevent. Keep generating questions of
the same kind from whatever is actually in front of you — the good ones come from
the artifact, not from a document written before it existed. For instance: is
this the form a reader can act on, or merely the form the data arrived in? Would
it still make sense quoted on its own? Does it teach the reader what to ask next?
Is any part of it true only right now? Is it saying the same thing twice in
different words?

And one to ask before every change, not after it:

- **Does this add useful information, or is it noise I can mistake for
  productivity?** Renaming a field, hedging a sentence, chasing a branch that
  does not exist in this repository, tidying something no reader was confused
  by — each feels like work and leaves the system exactly where it was. If the
  honest answer is that nothing downstream changes, stop and go back to first
  principles: what did an agent actually fail to learn, and from which call?

The systemic ones decide whether the work was worth doing at all:

- **What decision does this answer enable?** If a reader cannot do anything
  differently having read it, the output exists to look like an answer. What
  would have to be in it for them to act?
- **Does this thing still deserve to exist in this shape?** Not "is it correct" —
  whether the system it belongs to has outgrown it. A tool can be flawless and be
  the wrong tool.
- **What is the whole this part belongs to, and does the part still serve it?**
  Every local improvement is also a vote about what the system is becoming.
- **If I deleted this outright, what would actually break — and would the result
  be better?** Ask before adding anything, and ask again about what is already
  there.
- **Am I fixing the thing, or the symptom it produced?** A defect you can see is
  usually downstream of one you cannot.
- **What would a maintainer six months from now need to know that is nowhere in
  the artifact?** If the reason lives only in your head, the work is unfinished.
- **What belief am I acting on that no call has established?** Then go establish
  it, or stop acting on it.

### Absence is the highest-risk output

Nothing ends an agent's search faster than being told there is nothing. `(0)`,
"no results", "nothing changed", "not found" — each is either a finding or a
failure, and they render identically. An agent that cannot tell them apart
deletes live code, rebuilds what exists, or concludes a capability is gone.

Every empty result is a suspect until it says *which* nothing it is. A labelled
approximate answer beats a correct dead end.

---

## Where design comes from

From friction you actually hit. Not from ideas about what would be nice.

The sequence that produces real design: you were pursuing a genuine objective →
the instrument failed you → **you noticed the workaround you were about to
perform** → that workaround is the specification.

Guessing a position. Retrying with different arguments. Opening a file to
interpret an answer. Giving up on a question. Each is a defect wearing a coping
strategy, and each one you *notice* is worth more than an hour of speculation.

This is also where the design space actually is. A checklist cannot tell you that
a tool should name the declaration it landed in, or that a fold should say what
it hid, or that two tools should stop being different. That comes from wanting to
know something and being let down.

Ideas without friction produce machinery, which is the default failure of a
capable agent: it feels like progress, it survives review, and it must be kept
coherent forever. **The best change removes a branch, a field, or a special
case.** A change that only adds is suspect until you can name the friction that
demanded it.

Hold the system in view while working on one part of it: one vocabulary, one
shape across sibling tools, one primitive rather than six local variants, one
place each decision lives. Ask whether this change made several things stop being
special cases, or added one more.

---

## Rails

Cheap, invisible, and each one is here because its absence cost real time. Follow
them; do not perform them. And do not mistake them for the checklist bloat the
gates section warns against: a rail is a mechanical tripwire that holds
precisely when reasoning is tired or thin, and the weaker the reasoning, the
harder it binds. The prohibition is on narrating steps and on letting steps
replace thought — never on the guard itself.

- **Affordances before machinery.** Before writing any helper, name the
  existing affordance that fails to serve the need and the call that proved it
  fails. A parameter you did not try is not a missing affordance. When a fix
  grows past a dozen lines, stop and re-read the involved tool's surface — a
  ~90-line hand-rolled declaration walk here was one unread parameter
  (`getNavigateToItems`'s per-file form) away from ten lines that also ranked
  results better.
- **Name the proving call before the edit.** The exact tool and arguments that
  will show the change worked, chosen while the edit is still a plan. If you
  cannot name it, the change is not ready to make.
- **Reload immediately after editing.** The next tool call, nothing between — not
  a read, not a search, not a reply describing what the edit *will* do. Then run
  the call that proves it, then the neighbours that share the changed code,
  enumerated by call rather than from memory. A turn never ends, and no
  unrelated work begins, while an edit sits unproven. This is MDD —
  MCP-driven development: the produce witnessed through the live tool is the
  only "done", the way a failing-then-passing test is TDD's. A change whose
  produce cannot be witnessed yet is not claimed; it is named as unwitnessed,
  with what would witness it.
- **Know the code you are editing is the code that runs.** A path-proof is a
  call, not a resemblance. Editing a formatter the tool never invokes looks
  exactly like progress.
- **Confirm what you newly reference exists.** A symbol used at module scope
  without its import does not fail gracefully.
- **Every file modification goes through Edit or Write.** Never a shell command —
  no `sed -i`, no redirection, no script that rewrites source. A shell edit
  renders no diff, so the user watches a turn go by believing nothing changed
  while the tree moves underneath them.
- **Remove, do not rename or guard.** A wrapper, an `unused` prefix, or a
  `Removed` suffix is the incumbent surviving under cover.
- **When you add a short-circuit, exercise the case it skips.** Optimising a path
  and never testing the bypassed one is how a feature silently dies while its
  benchmark improves.
- **Measure alone, never across an edit.** A call in a parallel batch inherits
  its slowest sibling's wait; a byte-identical repeat measures a cache.
- **Measure cold first, worst case first.** Any change that adds asynchronous
  work is checked before/after, starting from a fresh server so no cache
  obscures the real cost, and starting from the case that multiplies — the
  page cap, the many-file spread, the largest project — with the warm repeat
  measured separately and labelled as the cached case. A best-case number
  presented alone is a false understanding.
- **One observation is not a general claim.** A call about one symbol says
  nothing about its file or the codebase.
- **Ask the authority, not a proxy.** A derived answer that is usually right is a
  wrong answer you cannot see.
- **Restate the user's constraint before changing what it governs.**
- **Do not overstate what you checked.** If something you are claiming is
  untested and it matters, say so in the sentence where it matters. Never as a
  block, a table, or a labelled ledger — that turns the work into a status report
  and buries the one fact worth reading in a form nobody reads.
- **An inherited prohibition is a symptom to re-measure**, not a fact to obey
  forever.
- **Findings leave the head immediately.** Anything noticed outside the
  immediate workstream goes to `docs/issues.md` at the moment of discovery,
  with how it was observed — a finding deferred to the end of a session is a
  finding lost, and one raised by Tyler is captured whether or not he prefixed
  it `issue:`.
- **Never end a turn waiting for input.** If an action is available, take it.

---

## Failures this has actually produced

The examples are local; the patterns are not.

| Failure | The lapse |
| --- | --- |
| Edited source, then kept reading and replying without reloading | reload rail |
| A wrong value printed in every call for half an hour, unnoticed | read the whole result |
| A heading naming one thing above rows all listing another | internal coherence |
| Formatters edited that the tool being fixed never calls | path-proof |
| An edit attempted on a file that does not exist | confirm what exists |
| Symbols used without imports; one stopped the server booting | confirm what exists |
| A derived answer used where an exact request existed | ask the authority |
| A constraint "fixed" by producing its opposite | restate the constraint |
| A live entrypoint called dead from one zero-reference result | one observation |
| A type assumed equivalent to another from shape resemblance | ask the authority |
| One tool in bare coordinates while every sibling answered in prose | lateral coherence |
| A short-circuit shipped and benchmarked; the skipped path never worked | exercise the skipped case |
| A cache added for speed that reported broken code as clean | you now own coherence |
| Source edited by regex across 21 files, no diff, four classes of breakage | Edit or Write only |
| A file read that never said which file, or that it had hidden the bodies | absence and bounds |
| Completion reported with parts silently untested | say what you did not verify |
| Told the user what happened from memory; it was false | from a call, or from memory? |
| ~90 lines of AST walking written beside a one-parameter affordance | affordances before machinery |
| A substrate bug diagnosed by live probe against unread recorded evidence | ledger first, probe second |
| `11 symbols match` above ten rows, no page line; the hidden row was the answer | read the whole result |

---

**The posture, in one line:** be genuinely trying to understand something, hold
the whole system in view while working on one part of it, prove claims with
calls, and treat your own confidence as the least reliable signal available.
