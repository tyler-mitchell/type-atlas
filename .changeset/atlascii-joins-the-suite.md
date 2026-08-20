---
"atlascii": minor
---

First publication. `@type-atlas/core` and `@type-atlas/mcp` depend on `atlascii` as a workspace package, so an npm install of the suite resolved a package that did not exist on the registry and failed with E404 — caught by the extended distribution verification, which now installs the packed tarballs into a clean consumer directory and requires the installed server to reproduce the captured tool catalog and every committed scenario response. atlascii joins the fixed version group and publishes with the suite.
