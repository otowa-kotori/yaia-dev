# 开发路线

架构说明见 [architecture.md](./architecture.md)，全局约定见根目录 `CLAUDE.md`。

## 已完成

当前已经完成的能力包括：

- 基础设施：`tick`、`rng`、`events`、`formula`、`content`、`save`
- 数值系统：`attribute` 与 GAS 风格的 `ability` / `effect`
- 战斗系统：`Battle`、scheduler、intent、击杀奖励
- 地点系统：`Location → Entry → Instance` 三层概念模型
- 场景系统：`StageController` 管理运行实例 actor 生命周期
- 场景进度：`combat zone → wave` 层级、波次随机选择、波次冷却与失败后重开
- 活动系统：`CombatActivity` 与 `GatherActivity`
- 战斗收尾：波次奖励、玩家团灭判负、战后低血量自动回血（基于 combat zone 阈值）
- 实体系统：Actor 层级与工厂
- 成长系统：XP / Level
- 持久化：自动存档
- 物品系统：`GearInstance`、固定位置网格背包、实例工厂、`ItemDef.roll`
- 背包溢出：`addStack` / `addGear` 返回结果而非异常；背包满时溢出到 `StageSession.pendingLoot`；同 itemId 自动合并；`pickUpPendingLoot` / `pickUpAllPendingLoot` API；切换地点时未拾取确认
- UI：极简界面，包含 location 选择、entry 入口菜单、战斗、采集、速度、日志与只读背包
- UI 复用：`ItemSlotCell` 通用物品格子组件、`PendingLootPanel` 待拾取面板（战斗 tab + 背包 tab 复用）

默认内容包括：`location.forest`（含普通/困难两个战斗入口）、`location.mine.copper`（含采集入口）、`combatzone.forest.slime_normal`、`combatzone.forest.slime_hard`、`monster.slime`、`monster.goblin`、`ability.basic.attack`、`skill.mining`、`item.ore.copper`、`item.monster.slime_gel`、`node.copper_vein`。

## 待办

### 🔴 核心循环

1. **装备系统**：补齐 Store 的 `equip` / `unequip`、UI 槽位，以及一件带属性的武器。数据层已经具备基础能力。
2. **合成系统**：加入 `CraftingActivity` 与对应 UI，先做第一个配方「铜矿 → 铜剑」，并统一走 `createGearInstance`。目标是打通“挖矿 → 合成 → 装备 → 战斗”的循环。
3. ~~**多角色**：支持多个 PlayerCharacter 并行活动、列表切换与 3–9 的上限。该项会明显改动 UI，因此放在 1 和 2 之后。~~ ✅ 已完成：2 个初始英雄，CharacterController 两层接口，Stage 独立于角色。

### 🟡 打磨

4. **属性展示**：在英雄卡片中显示 `ATK` / `DEF` / `STR` / `DEX` / `INT` / `WIS`。
5. **可读战斗日志**：把日志中的内容 ID 替换为可读名称。
6. ~~**离线追进度**~~：✅ 已完成。`computeCatchUpTicks` 纯函数 + `visibilitychange` 热恢复 + 冷恢复追帧，上限 24 小时。
7. **背包交互**：支持 equip、丢弃与 drag-and-drop。

### 🟢 后续

- **怪物掉落**：把 `MonsterDef.drops` 接入击杀奖励流程。装备路径已经通过 `addItemToInventory` 自动分流到实例工厂。
- **更多内容**：补充更多 location、combat zone、怪物、配方与装备梯度。
- **天赋系统**：实现树状 DAG；相关字段已经预留。
- **WorldActivity**：加入不绑定单个 PlayerCharacter 的后台活动；接口已经存在。
- **数据驱动 Intent**、**公式字符串 parser**、**IndexedDB 存档**：接口都已预留，后续接入。

## 下一个 PR

优先把 1 和 2 放进同一个 PR。3 单独做。4–7 作为后续打磨项处理。
