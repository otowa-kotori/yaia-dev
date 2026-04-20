# 开发路线

记录已完成内容与下一步计划。架构看 [architecture.md](./architecture.md)，约定看根目录 `CLAUDE.md`。

## 当前进度（提交历史推进到 Step 6 完成）

**已完成：** 基础设施（tick / rng / events / formula / content / save）、数值（attribute + GAS 风 ability/effect）、战斗（Battle + scheduler + intent 注册表 + kill 奖励）、关卡（Stage + Controller + 死 actor 回收）、Actor 完整层级、CombatActivity + GatherActivity、XP / Level 系统、自动存档 + 读档 + migration 占位、极简 UI（stage 切换 / fight / mine / HP + XP 条 / 速度控制 / 战斗日志）。

**默认内容：** `stage.forest.lv1` 战斗关、`stage.mine.copper` 采矿关、`slime` 怪、`basicAttack` 技能、`skill.mining` 技能、`item.ore.copper` 物品、`node.copper_vein` 矿点。

**测试：** 115 通过。Typecheck + vite build 全绿。

## 待办事项（按优先级）

### 🔴 核心循环（必要）

1. **背包 UI** — `state.inventories` 已在用；玩家看不见。最小列表即可。

2. **装备系统** — `equipped` + `rebuildCharacterDerived` 已支持装备 modifier。缺 Store 的 equip / unequip 动作 + UI 槽位展示 + 至少一件带属性加成的武器。

3. **合成系统** — `RecipeDef` 类型已存在未实现。需要 `CraftingActivity`（N tick 消耗输入产出输出 + 技能 XP）+ UI。第一个配方：铜矿 → 铜剑。闭合「挖 → 造 → 装 → 战」。

4. **多角色** — `state.actors` 从 day 1 就是数组，但 UI / Store 假定单英雄。每 PC 独立活动并行、角色列表 + 切换、固定上限 3–9。结构性 UI 改动，建议放在 1-3 之后。

### 🟡 打磨

5. **属性展示** — 英雄卡片露出 ATK / DEF / STR / DEX / INT / WIS。现在玩家完全感受不到「我变强了」。

6. **可读战斗日志** — ID 解析成名字：`Hero 用 Attack 攻击 Slime → 8 伤害`。

7. **离线追进度** — 存档加 wall clock 时间戳；读档计算流逝秒数，`runForTicks` 追帧（上限 4h）。基础设施已有。

### 🟢 后续

8. **怪物掉落** — `MonsterDef.drops` 接进 kill 奖励 Effect。
9. **更多内容** — stage / 怪 / 配方 / 矿点 / 装备梯度。
10. **天赋系统** — 树 DAG 引擎。字段已留。
11. **WorldActivity** — 不绑 PC 的后台活动（种菜、熔炉队列）。接口已在。
12. **数据驱动 Intent** — `PriorityListIntent` 读规则表。
13. **公式字符串 parser** — 接口预留。
14. **IndexedDB 存档** — `SaveAdapter` 已抽象。
15. **第一个 migration** — 第一次改 schema 时在 `migrations` 数组里写。

## 建议的下一个 PR

**1–3 一起做**（背包 UI + 装备 + 合成 + 1 个配方）。共享类型、UI 区域，组成第一个「玩 10 分钟看到自己明显变强」的闭环。所有钩子都已存在，架构零风险。

**然后做 4**（多角色），单独一个 PR，因为会重塑 UI。

**再做 5–7 打磨。**
