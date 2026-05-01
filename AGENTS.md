# CLAUDE.md

Project-specific conventions for Claude. Read before editing code.

## Orientation

- Architecture overview: `docs/architecture.md` (MUST read layering / dependency direction / cross-module conventions).
- Per-module design notes: `docs/modules/<name>.md` (MUST read the relevant one before editing that module).
- Current progress & TODOs: `docs/roadmap.md`.
- Read the relevant docs before touching code — do NOT grep the codebase blindly to infer architecture.
- Maintain a critical mindset; do not accept technical compromises lightly. Seek out the most correct solution.
- When there are issues with user requirements, ask questions decisively. Dare to challenge every decision the user makes.

## Communication

- Default to replying to the user in 中文 unless the user explicitly asks for another language.
- Keep the tone direct, calm, and technically grounded. Always willing to challenge requirements, but do so with clear reasoning rather than combative language.
- For user-facing explanations, prefer readable prose over compressed shorthand. Define important terms before diving into constraints.
- When editing documentation, optimize for clarity first: avoid unexplained abbreviations, avoid internal slang, split dense sentences, and keep a stable structure such as "定位 → 职责 → 边界 → 入口" when it helps.
- Prefer one main idea per sentence or bullet. If a sentence mixes lifecycle, persistence, and invariants at once, split it.

## Tools

- Use `fd` to find files and `rg` to search contents. Do NOT use `find` or `grep`.
- Use `bun` for Typescrit and `uv` for Python.
- On Windows, use `pwsh7` instead of powershell.
- To surface TypeScript diagnostics in this PowerShell workspace, run `bun typecheck 2>&1`.

## `.local`（工作区生成物）

- **平衡测试示例 JSON、HTML 报告、CLI 导出的快照 JSON** 等放入 `.local/`（例如 `.local/balance-test/`）。**不要**把这些文件塞进 `.agent/skills/` 等工作区 Skill 目录：Skill 目录只保留 `SKILL.md` 这类说明。
- `.gitignore` 已忽略 `.local` 下典型生成物（如 `*.html`、`balance-last-run.json`）；可提交的模板（如 `balance-example.json`）保留在 `.local/balance-test/` 供团队对齐路径。

## Comments

- **When refactoring, do NOT silently delete existing comments.** Comments document intent and tradeoffs that often aren't obvious from the new code. If a comment is stale, update it; if it's wrong, mark it wrong and explain why; if it's truly obsolete, call that out in the diff summary so the user can confirm. Default to preservation.
- When a block of code moves, its comments move with it.
- Top-of-file "design notes" headers are load-bearing — keep them updated as invariants evolve, not deleted.

## Style

- Alpha stage: no fallbacks for missing content / data. Throw loudly on bad inputs so bugs are visible. `getX(id)` style helpers throw; callers don't wrap in try/catch unless a specific use case justifies swallowing.
- Alpha stage: do NOT bump `SAVE_VERSION` or write migrations. Old saves are simply discarded on schema changes. Only add migrations when explicitly told to.
- Time units inside game-core are logic ticks. ms only at the UI boundary.
- All gameplay RNG flows through `ctx.rng`. No `Math.random()` in core.
- Battles / scheduler state / intent state must be JSON-safe (plain data) so `GameState` can round-trip through a save file.
- For type narrowing, prefer shared type guards like `isPlayer()` instead of direct checks such as `actor.kind === "player"` when a guard already exists.
- Content IDs are dot-namespaced (`ability.fire.fireball`, `item.ore.copper`). Coin the ID once; renaming later costs a migration.

## Text

- The game ships in Chinese only. No i18n framework at this stage.
- **Content-layer text** (`name`, `description` in content definitions): write Chinese directly in `content/index.ts`. Content IDs stay English dot-namespaced.
- **UI-layer text** (button labels, status messages, section titles, hints): import from `src/ui/text.ts`. Do NOT hardcode bare Chinese literals in `.tsx` files (comments excluded).
- Shared helpers like `slotLabel()` and `currencyName()` also live in `text.ts` — do not duplicate them in individual views.
- To audit for leaked bare Chinese in UI files: `rg '[\u4e00-\u9fff]' src/ui/*.tsx --glob '!text.ts' -n`
- Test fixtures in `tests/` have their own content definitions; those names don't need to match `content/index.ts`.

## Tests

- bun test. Put new tests under `tests/core/<module>.test.ts` mirroring source layout. Fixtures live in `tests/fixtures/`.
- Typecheck (`bun typecheck`) must be clean on commit.
- Use `playwright-cli` to run E2E tests when you need to finally test the feature in the browser.

## Commits

- Don't mention AI Agent (Claude, Cursor, etc) in commit messages.
