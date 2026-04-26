# 开发路线

架构说明见 [architecture.md](./architecture.md)，全局约定见根目录 `CLAUDE.md`。

## 当前现状

这个仓库现在已经不是最早那版“能力壳 + 旧 ATK/DEF/WIS + 旧 ability 文档”的状态了。当前主线已经切到：

- `TalentDef / EffectDef / EffectInstance`
- `PATK / MATK / PDEF / MRES / SPD`
- ATB 调度
- WorldActivity 化的战斗 / 副本活动

## 已完成

当前已经完成的能力包括：

- 基础设施：`tick`、`rng`、`events`、`formula`、`content`、`save`
- 数值系统：`attribute`、dynamic provider、lazy invalidation
- 行为系统：`talent` 施放管线、`effect` 生命周期、reaction hooks
- 战斗系统：`Battle`、ATB scheduler、intent、击杀奖励、波次奖励
- 地点系统：`Location → Entry → Stage` 三层概念模型
- 场景系统：`StageController` 管理运行实例 actor 生命周期
- 活动系统：
  - `CombatActivity`（WorldActivity，支持多人组队）
  - `GatherActivity`
  - `DungeonWorldActivity`
- 战斗恢复：
  - 搜敌阶段的波间恢复
  - 队伍减员后的 `deathRecovering` 死亡恢复阶段
- 多人组队战斗：共享同一 `Stage + Battle`，击杀奖励与货币波次奖励按存活人数平摊，物品波次奖励随机发给一人
- 持久化：自动存档、读档重建派生角色状态
- 物品系统：`GearInstance`、固定位置网格背包、实例工厂、`ItemDef.roll`
- 背包溢出：`pendingLoot`、统一拾取 API、切换地点时未拾取确认
- UI：基础 location / battle / dungeon / inventory / talents / log 面板

## 当前默认内容

默认内容现在至少包括：

- 地点：`location.prairie`、`location.twilight`、`location.mine.ironfang`
- 基础怪物：`monster.slime` 等 early-game monster
- 基础攻击：`talent.basic.attack`、`talent.basic.magic_attack`
- 已实现职业天赋：骑士 6 天赋
- 技能：`skill.mining`
- 材料：`item.ore.copper`、`item.monster.slime_gel`

## 现阶段最重要的事实

- 文档层面，旧的 `ability` / `knownAbilities` / `recovering` 叙述已经不再代表现状
- 内容层面，**只有骑士职业 talent 真正落地**；游侠 / 法师 / 圣女目前只有角色壳、基础攻击和基础属性
- 数值层面，ATB 与新属性体系已到位，但物理伤害公式仍有“设计目标”和“当前 runtime”之间的同步欠账

## 待办

### 🔴 核心同步

1. **补完三职业 talent 内容**：游侠 / 法师 / 圣女还没接入职业天赋树
2. **把物理伤害 runtime 同步到新的破甲线设计**：当前 `phys_damage_v1` 仍是旧实现
3. **统一 talent / TP 设计与代码**：设计目标是“每级 +1 TP + 额外来源”，当前实现仍是 `×3`

### 🟡 打磨

4. **属性展示**：在英雄卡片和面板里更系统地展示 `PATK / MATK / PDEF / MRES / SPD`
5. **可读战斗日志**：把更多运行时结果翻译成可读名称和清晰语义
6. ~~**离线追进度**~~：✅ 已完成。`computeCatchUpTicks` + 热恢复 / 冷恢复追帧已接通
7. **背包交互**：继续补 equip、丢弃与 drag-and-drop 细节
8. **talent 构筑 UX**：装备槽、互斥姿态、优先级解释还需要更清楚的 UI

### 🟢 后续

- **更多内容**：补更多地点、combat zone、dungeon、怪物、掉落、装备梯度
- **职业命名统一**：决定是否把“骑士 / 圣女”迁到“战士 / 牧师”语义，并评估内容 ID 迁移成本
- **数据驱动 intent 条件扩展**： richer condition set 与更强的自动战斗表达力
- **IndexedDB 存档**：接口已留，后续接入

## 最近一段时间的优先级

如果只看最影响主线体验的事情，优先顺序应当是：

1. 补职业 talent 内容
2. 同步物理伤害公式
3. 打磨 talent 构筑与日志可读性
