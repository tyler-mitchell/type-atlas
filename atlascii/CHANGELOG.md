# atlascii

## 0.4.1

### Patch Changes

- 97a21a3: `atlascii@0.4.0` is unusable and this release replaces it. Its published
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

## 0.4.0

### Minor Changes

- b3d1e2b: First publication. `@type-atlas/core` and `@type-atlas/mcp` depend on `atlascii` as a workspace package, so an npm install of the suite resolved a package that did not exist on the registry and failed with E404 — caught by the extended distribution verification, which now installs the packed tarballs into a clean consumer directory and requires the installed server to reproduce the captured tool catalog and every committed scenario response. atlascii joins the fixed version group and publishes with the suite.

### Patch Changes

- 376ac46: `impact` says "at least N uses" whenever retrieval named packages the count could not confirm, and its table finally names its columns (package · uses · files · tests). `compose`'s subject ask binds `at` as finished `line:column` text — the raw protocol object rendered as nothing, leaving a dangling colon in dossier headings — and atlascii's `position()` document function passes already-formatted text through, so both spellings agree. `list_module_exports` signatures drop the probe's internal `__module.` qualifier — `(left: Money, right: Money) => Money`, the names a consumer actually writes. `quorl` positions in a file-grouped branch stand alone (`negate · 39:14`), no longer wearing a colon whose path the row above already said. `inspect_symbol`'s partial mentions section now hands the reader its next move ("references lists all 38, with paging"), and the implementation-walk caveat no longer renders under a type alias, where it read as a promise of hidden implementors. Two answers stop overstating. `find_successor`: a name whose only declarations sit in test files now answers "Declared only in tests — residue, not a capability" instead of "this name resolves", each declaration row marks its test location, and "Files discussing it" lists each file once instead of once per matching chunk. `document_symbols`: an object literal's insides are data, not declarations — a literal-valued symbol keeps its row and prices what it holds (`bankProfiles [variable] … · 33 entries`) instead of dumping every nested property, while function bodies and type members stay declaration trees and `raw` remains the complete hierarchy. And `verify_edit` no longer poisons the session it runs in: diagnosing a proposal used to leave the server answering the closed proposal's content for that file for the rest of the session (Volar caches the opened text under the file's disk mtime, which a read-only tool never moves), so navigation after a verify answered stale positions — the document now opens with disk text and carries the proposal as an ordinary versioned edit, changed back before closing, and the answers that follow describe the file that exists. Two more session-order defects fall, both caught by the new shuffled-replay determinism gate: reference answers no longer list probe documents (TypeScript retains closed probes in its program, and one rendered into a `file_references` answer as a phantom file no reader can open), and rename patches list their files in path order instead of the server's internal registry order, so the same rename renders the same patch in every session.
