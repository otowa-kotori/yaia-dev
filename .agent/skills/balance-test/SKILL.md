---
name: balance-test
description: |
  Game balance testing via scripts/balance/cli.ts — headless combat simulation through GameSession.
  Use when: combat balance, hero vs zone difficulty, farming rates (XP/gold), or validating numeric/content changes.
  Do NOT invent hero/zone/item IDs: always discover them with the CLI list command first.
  Trigger keywords: balance, simulate, sim, DPS, win rate, farming, Phase0.
---

# Balance Testing CLI

入口：`scripts/balance/cli.ts`。战斗、结算、回复等均走 `GameSession`，不在脚本里复制战斗公式。

## 与「当前版本内容」的关系

- **Skill 正文不写死任何 heroId / combatZoneId / 物品 ID**。这些内容随版本会变；可靠做法是每次先用 `list` 拉当前构建下的合法 ID。
- **示例 JSON、HTML、一次性 JSON 导出等工作区文件一律放在 `.local/balance-test/`**（勿写入 `.agent/skills/` 等工作区 Skill 目录）。仓库内可参考已提交的 `.local/balance-test/balance-example.json`；生成报告示例见下方命令。

## 目录（脚本侧）

```
scripts/balance/
  cli.ts       commander 入口
  config.ts    配置类型、校验、glob 展开
  setup.ts     通过 Session API 捏英雄
  simulate.ts CombatActivity 驱动与采样
  stats.ts     指标聚合
  report.ts    终端表 / JSON / HTML
  profiles/    可选：仅含 heroProfiles 的片段文件（配合 glob 模式 run）
```

## 命令

### list — 列出当前构建下的合法 ID（应先执行）

```bash
bun run scripts/balance/cli.ts list
bun run scripts/balance/cli.ts list heroes
bun run scripts/balance/cli.ts list zones
bun run scripts/balance/cli.ts list items
bun run scripts/balance/cli.ts list talents
```

### quick — 单次即兴测试

```bash
bun run scripts/balance/cli.ts quick <heroId> <zoneId> [-l <level>] [--weapon <itemId>] [-d <分钟>]
```

### run — 片段 JSON + profile/zone glob

```bash
bun run scripts/balance/cli.ts run <profiles.json> -p '<glob>' -z '<glob>' [-d <分钟>] [--json] [--html <路径>]
```

`-p` / `-z` 可重复；`*` 为子串通配。

### run — 完整场景 JSON（profiles + scenarios）

```bash
bun run scripts/balance/cli.ts run <config.json> [-s '<场景名称子串>'] [-d <分钟>] [--json] [--html <路径>]
```

Phase0 同级对照示例配置（可复制后按需改 ID）：`.local/balance-test/balance-example.json`。生成 HTML / 机器可读快照示例：

```bash
bun run scripts/balance/cli.ts run ".local/balance-test/balance-example.json" -d 60 \
  --html ".local/balance-test/balance-report.html"
bun run scripts/balance/cli.ts run ".local/balance-test/balance-example.json" -d 60 \
  --json > .local/balance-test/balance-last-run.json
```

## Profile 字段（片段文件或完整 config 共用）

JSON 字段含义：`heroId`、`level`、`equipment`、`talents`、`equippedTalents`（见仓库示例文件）。

新存档会先套用英雄的 `startingItems`；`equipment` 再追加并尝试自动装备。若场景只需要「Starter 武器 + 裸天赋」，一般不必填 `equipment` / `talents`。

天赋是否能点取决于当前 `HeroConfig`（例如是否存在 `availableTalents` 白名单）；拿不准时用 `list talents` 对照并在小配置上试跑校验。

## 输出指标（终端表 / JSON）

| 列 | 含义 |
|----|------|
| DPS | 全程有效秒伤（含休整），damage / tick |
| Death rate | 每波死亡恢复次数期望 |
| XP/min | 每分钟角色经验 |
| gold/min（或 currency） | 每分钟货币收益 |

## 典型用法（不写死 ID）

- **验关卡数值**：`list zones` 找到目标 zone → `quick` 或 config 场景对齐等级。
- **比构建**：同一 zone、不同 profile（装备/天赋）对比 JSON 输出。
- **刷怪曲线**：glob 多 zone，`run profiles.json -p '前缀*' -z 'combatzone.*'`（pattern 仍以 `list` 为准）。

## 源码索引（按需跳转）

- 战斗区域：`src/content/default/combat-zones.ts`
- 怪物：`src/content/default/monsters/`
- 英雄：`src/content/default/heroes.ts`
- Balance 脚本：`scripts/balance/*.ts`
