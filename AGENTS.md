Code Guidelines:
- Scripting Language: TypeScript script files
- Programming Style: Functional Programming

Implementation Planning:
- Before implementing a new language-server or MCP capability, first identify what existing Volar.js / LSP capabilities already provide that behavior or most of it.
- Prefer leveraging or composing existing Volar.js capabilities before building new custom logic from scratch.
- If custom implementation is still needed, document the gap in existing Volar.js behavior and keep the custom layer narrowly scoped around that gap.

Live MCP Usage:
- If a user asks you to use the live Featuretype MCP, first verify that Featuretype MCP is actually attached to the current session as a first-class tool.
- If it is attached, use the MCP tools directly.
- If it is not attached, say that plainly before doing any indirect stdio/client probing, and do not present indirect probing as if it were direct MCP tool usage.
