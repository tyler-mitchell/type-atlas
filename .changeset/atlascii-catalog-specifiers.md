---
"atlascii": patch
---

`atlascii@0.4.0` is unusable and this release replaces it. Its published
manifest carried pnpm's workspace catalog protocol verbatim —
`{"messageformat": "catalog:", "pathe": "catalog:"}` — because it was published
with `npm publish` by hand rather than through the release workflow. npm has no
`catalog:` protocol, so any install resolving it fails with
`EUNSUPPORTEDPROTOCOL`, and that took `@type-atlas/core@0.4.0` and
`@type-atlas/mcp@0.4.0` down with it: both depend on `atlascii@0.4.0`, so npm
died building their trees too, reporting nothing beyond a log path.

Only pnpm rewrites `catalog:` and `workspace:*` into real ranges at publish
time, which is why the three packages CI published are sound and the one
published by hand is not. The release workflow is the only sanctioned
publisher for exactly this reason.
