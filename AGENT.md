# Agent Notes

- For actor narrowing, prefer shared type guards like `isPlayer()` instead of direct checks such as `actor.kind === "player"` when a guard already exists.
- To surface TypeScript diagnostics in this PowerShell workspace, run `bun run typecheck 2>&1`.
