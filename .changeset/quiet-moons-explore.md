---
"@type-atlas/mcp": patch
---

Keep `explore_symbol` usable when semantic retrieval is unavailable. A failing
similarity provider previously discarded the completed language-server
inspection and returned only the provider error, so an environment without `uv`
lost definitions, implementations, callers, calls, and references for every
explored symbol. The inspection is now returned with a short note explaining why
the related-code section is missing, while cancellation and timeouts continue to
propagate as errors. Installation documentation now states that the retrieval
tools require `uv` and that everything else runs on Node.js alone.
