# 开发路线

架构看 [architecture.md](./architecture.md)，约定看根目录 `CLAUDE.md`。

## 已完成

基础设施（tick / rng / events / formula / content / save）、数值（attribute + GAS 风 ability/effect）、战斗（Battle + scheduler + intent + kill 奖励）、关卡（Stage + Controller）、Actor 层级、CombatActivity + GatherActivity、XP/Level、自动存档、道具系统（`GearInstance` + 固定位置网格背包 + 创生工厂 + `ItemDef.roll`）、极简 UI（stage/fight/mine/速度/日志/只读背包）。

默认内容：`stage.forest.lv1`、`stage.mine.copper`、`monster.slime`、`ability.basic.attack`、`skill.mining`、`item.ore.copper`、`node.copper_vein`。

## 待办

### 🔴 核心循环

1. **装备系统** — Store 的 equip / unequip + UI 槽位 + 一件带属性的武器。数据层全就绪。
2. **合成系统** — `CraftingActivity` + UI，首个配方「铜矿 → 铜剑」（走 `createGearInstance`）。闭合「挖 → 造 → 装 → 战」。
3. **多角色** — 每 PC 独立活动并行、列表/切换、上限 3–9。会重塑 UI，放 1-2 之后。

### 🟡 打磨

4. **属性展示** — 英雄卡片露 ATK/DEF/STR/DEX/INT/WIS。
5. **可读战斗日志** — ID → 名字。
6. **离线追进度** — 存档加 wall clock，读档 `runForTicks` 追帧（上限 4h）。
7. **背包交互** — equip / 丢弃 / drag-drop。

### 🟢 后续

- **怪物掉落** — `MonsterDef.drops` 接进 kill 奖励（装备路径已通过 `addItemToInventory` 分流自动走工厂）。
- **更多内容** — stage / 怪 / 配方 / 装备梯度。
- **天赋系统** — 树 DAG。字段已留。
- **WorldActivity** — 不绑 PC 的后台活动。接口已在。
- **数据驱动 Intent**、**公式字符串 parser**、**IndexedDB 存档** — 接口都预留。

## 下一个 PR

1 + 2 一起做。3 单独 PR。4–7 打磨。
