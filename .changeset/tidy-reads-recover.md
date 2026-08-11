---
"@type-atlas/mcp": patch
---

Accept a `read_file` file view that arrives JSON-encoded. `file` takes a path or
a `{ path, startLine, endLine, fold }` view, and a caller reconstructing that
union sometimes sends the view as a string. The string was then treated as a
path, producing a request for a percent-encoded filename and a "Source document
is unavailable" error naming a file that never existed.

Such a string is now decoded back into the view it represents, since a real path
never parses as a JSON object. A JSON string that is not a file view is rejected
with a message naming the shape `read_file` expects, rather than being resolved
as a path.
