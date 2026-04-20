# CLAUDE.md

Project-specific conventions for Claude. Read before editing code.

## Comments

- **When refactoring, do NOT silently delete existing comments.** Comments document intent and tradeoffs that often aren't obvious from the new code. If a comment is stale, update it; if it's wrong, mark it wrong and explain why; if it's truly obsolete, call that out in the diff summary so the user can confirm. Default to preservation.
- When a block of code moves, its comments move with it.
- Top-of-file "design notes" headers are load-bearing — keep them updated as invariants evolve, not deleted.

## Style

- Alpha stage: no fallbacks for missing content / data. Throw loudly on bad inputs so bugs are visible. `getX(id)` style helpers throw; callers don't wrap in try/catch unless a specific use case justifies swallowing.
- Time units inside game-core are logic ticks. ms only at the UI boundary.
- All gameplay RNG flows through `ctx.rng`. No `Math.random()` in core.
- Battles / scheduler state / intent state must be JSON-safe (plain data) so `GameState` can round-trip through a save file.
- Persisted actor fields: currentHp, currentMp, activeEffects, cooldowns, attrs.base, per-kind source fields (level/exp/equipped/talents/knownAbilities/xpCurve/skills for PlayerCharacter; defId for Enemy). Derived fields (attrs.modifiers, attrs.cache, runtime abilities list) are rebuilt on load.
- Content IDs are dot-namespaced (`ability.fire.fireball`, `item.ore.copper`). Coin the ID once; renaming later costs a migration.

## Tests

- bun test. Put new tests under `tests/core/<module>.test.ts` mirroring source layout. Fixtures live in `tests/fixtures/`.
- Typecheck (`bun run typecheck`) must be clean on commit.

## Commits

- Don't mention Claude in commit messages.
