---
"@type-atlas/mcp": patch
---

Say each thing once in the tool surface.

Tool descriptions and schemas are serialized into every model request, so text
repeated between the server instructions and a tool's own description is paid for
on every call an agent makes, whichever tool it calls. The `diagnostics`
description and its `scope` field restated the changed-versus-project semantics
the server instructions already give; both are now the short form.

The `directory` description was also stale as well as long. It told agents that
each distinct directory has its own Semble index and that scoping therefore
answers faster — true before the workspace became the index, and misleading now
that scoping costs nothing. It says what it does instead.
