---
"@type-atlas/mcp": minor
"@type-atlas/core": minor
---

Add `watch_diagnostics`, a bounded subscription to one file's diagnostics.

An agent otherwise learns that its edit broke something only by asking, and an
agent mid-edit rarely thinks to ask. This registers a resource for the file and
invalidates it whenever the diagnostics change, so a client holding a
subscription is told without the agent spending a call.

The trigger is any change in the workspace rather than a change to the watched
file, because a file's diagnostics most often change when a *different* file is
edited — the case a file-bound watcher stays silent through, and the one an agent
most needs to hear about. Each settled change re-reads the file through the
language server, so what is published is the language server's own answer.
Repeated writes that settle to the same result stay silent, and a burst collapses
into one report.

Delivery is the client's half. `sendResourceUpdated` reaches a 2026-07-28
`subscriptions/listen` stream and a 2025 client alike, and the client reads the
resource back for the report, because the protocol's change event carries a URI
and no content. A client that ignores resource updates receives nothing beyond
the tool's own reply, and both the reply and the server instructions say so
rather than implying a delivery that will not happen.

`@type-atlas/core` gains `observeChanges` on a workspace, which reports every
file change to a caller. The workspace already watches its root to keep the
language server's file view current, so this reuses that watcher instead of
having callers start one of their own.
