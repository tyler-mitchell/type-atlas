---
"@type-atlas/core": patch
---

Stop `list_module_exports` and `search_dependency_code` from leaking a source
file per call.

Both answer by opening a synthetic probe document beside the importing file and
reading completions from it. The probe carried a fresh random name on every
call, so TypeScript saw a source file it had never seen each time and retained
it: eight identical calls against one small package grew the language server
from 503 MB to 631 MB, about 18 MB apiece, with no plateau. Enough calls
exhausted its heap, which killed the workspace and failed every request in
flight with only a note that the connection was disposed.

The probe now derives its name from the importing file, so the language server
sees one file being edited rather than an unbounded set of new ones, and the
same eight calls hold flat. `withTextDocument` serializes callers sharing a uri
and versions each open, which is what the random name was avoiding: two
overlapping probes would otherwise close the document out from under each other.
