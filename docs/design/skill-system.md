# 技能系统架构

> 依赖：[combat-formula.md](./combat-formula.md), [jobs.md](./jobs.md), [reactive-attrs.md](./reactive-attrs.md)
> 
> **状态**：设计已收敛，部分已实现。本文同时记录“现行模型”和“未落地项”。

---

## 1. 先说清楚当前状态

### 已落地

- 核心语义已经从旧 `AbilityDef` 切到 `TalentDef`
- 施放入口是 `tryUseTalent()`
- `TalentDef` 支持 `active / passive / sustain`
- `EffectDef` 支持 `onApply / onTick / onRemove / reactions`
- cooldown、buff 持续时间、periodic 频率都按 **owner action count** 计数
- 玩家 AI 使用 `equippedTalents + TalentDef.intentPriority` 自动生成 `PRIORITY_LIST`
- 基础攻击与骑士 6 个 talent 已接入内容库

### 未落地 / 仍待补完

- 游侠 / 法师 / 圣女（牧师）职业 talent 内容
- 玩家手动拖拽式的优先级 UI
- 更丰富的 intent 条件库
- 目录名从 `behavior/ability` 迁到 `behavior/talent`（当前只是语义已变，目录未改）

---

## 2. 概念模型

当前模型是三个核心层次：

```text
TalentDef        角色/怪物能学什么、怎么施放
EffectDef        一种效果模板，定义命中后如何结算
EffectInstance   施加在角色身上的运行时实例（JSON-safe）
```

### 为什么没有单独的 Action 层

我们当前不需要 GAS 那种“技能壳 + 异步 Task + 网络预测”的复杂度。对于挂机 RPG：

- 简单技能可以直接写 `effects[]`
- 复杂技能写在 `TalentDef.execute()` 里自由编排
- 多段、分配、条件分支都直接在 `execute()` 里做

如果以后真的需要拆 Action 层，那也是函数级重构，不应该倒逼存档结构变更。

---

## 3. TalentDef

现行设计中，`TalentDef` 的职责是：

- 定义 talent 类型：`active / passive / sustain`
- 定义主动技能的资源、CD、能量消耗、目标类型
- 定义复杂技能的 `execute()`
- 定义 passive / sustain 的 `grantEffects()`
- 为自动战斗提供 `intentPriority`、`intentTargetPolicy`

### 三种类型的真实语义

| 类型 | 学习时 | 战斗中 |
|------|--------|--------|
| `active` | 提升 `talentLevels`；首次学会后加入 `knownTalents` | intent 选中后走 `tryUseTalent()` |
| `passive` | 直接安装长期 effect | 始终生效，不占行动 |
| `sustain` | 学会后可装备 / 开关；激活时安装长期 effect | 持续生效，通常属于互斥组 |

### sustain 安装时机（已修正）

旧稿曾写“`createBattle()` 后、首次 `tickBattle()` 前统一安装 sustain”。这已经不是现状。

当前实现是：

- 学会 sustain 时，如果有空槽，可自动装备
- `equipTalent()` / `toggleSustain()` 时安装或卸载它的长期 effect
- 长期 effect 以 `EffectInstance.remainingActions = -1` 表示

也就是说，sustain 的开启/关闭是**角色构筑状态**的一部分，而不是“开战前临时补一个 buff”。

---

## 4. EffectDef 与 EffectInstance

### EffectDef

`EffectDef` 当前支持：

- `kind: instant | duration | periodic`
- `modifiers` / `computeModifiers`
- `formula`
- `rewards`
- `onApply / onTick / onRemove`
- `reactions`

### EffectInstance

运行时 effect 实例必须 JSON-safe，核心字段包括：

- `effectId`
- `sourceActorId`
- `sourceId`
- `sourceTalentId?`
- `remainingActions`
- `stacks`
- `state`

### infinite 的表达

当前没有 `durationType = "infinite"` 的独立 effect 定义类型；无限持续靠：

```text
EffectInstance.remainingActions = -1
```

表示。

---

## 5. Reaction：为什么挂在 effect 上

关键原因仍然成立：

- 反击护盾、代伤、受击触发这类行为，生命周期跟“被施加的状态”绑定
- 它们不应该挂在目标角色自己的 talent 上
- 也不适合做成全局事件总线订阅

所以：

- `reactions` 跟着 effect 实例存在和消亡
- 战斗结算内通过 `dispatchReaction()` 同步触发
- 这套机制和全局 `GameEventBus` 是两层不同语义

---

## 6. Intent：当前真实语义

### 玩家

当前不是“玩家在 UI 里拖拽一整条优先级表”。

真实实现是：

1. 玩家把 active / sustain talent 装到 `equippedTalents`
2. 每个 talent 自己声明 `intentPriority`
3. `buildBattleIntents()` 给所有参战者统一分配 `INTENT.PRIORITY_LIST`
4. `PRIORITY_LIST` 在运行时从 `equippedTalents` 动态构造规则

所以当前 priority 的真值在 **TalentDef** 和 **equippedTalents**，不在一份独立的 UI 拖拽数据里。

### 敌人

- 优先读取 `MonsterDef.intentConfig`
- 否则从 `MonsterDef.talents` 自动构造优先级列表

### RANDOM_ATTACK 的位置

`RANDOM_ATTACK` 仍然保留，但已经退回到 fallback / 测试角色，不是正式战斗主路径。

---

## 7. 怪物也走 talent 管线

这一点没有变：人怪同模。

但旧稿里提到的 `MonsterDef.passiveEffects` 已经过时。当前 `MonsterDef` 并没有这个字段。

现阶段怪物的建模方式是：

- `MonsterDef.talents` 声明怪物可用 talent 列表
- 怪物默认攻击就是 talent
- 如果将来怪物需要长期被动，也应走同一套 talent / effect 安装逻辑，而不是额外开一条 `passiveEffects` 专线

---

## 8. 当前已落地的示例：骑士

当前内容里，骑士 6 个 talent 都已经存在：

- `重击`：单体高系数物理伤害，MP 消耗随等级提升
- `坚韧`（id 仍为 `fortitude`）：长期 +HP% / +HP_REGEN
- `反击`：受击且实际掉血后概率反击
- `狂怒`：sustain，+PATK% / -PDEF%
- `守护`：sustain，+PDEF% / -PATK%，并带代伤逻辑
- `战吼`：**当前实现是给自己上 buff**，提高 `AGGRO_WEIGHT` 与 flat `PDEF`，不是“给所有敌人挂 taunt debuff”

这个 `战吼` 行为是旧文档最容易误导人的点之一。

---

## 9. 与属性系统的关系

技能系统不自己维护“刷新检查点”。

- 属性派生与动态 modifier 统一由 `reactive-attrs.md` 描述的 lazy invalidation 机制负责
- talent 升级时，做的是“拆旧 effect / provider，再装新 effect / provider”
- buff 改属性后，依赖链自动失效，不需要技能系统额外手动刷新

---

## 10. 与当前代码的边界约定

### 已经应该被视为事实的约定

- `tryUseAbility` → `tryUseTalent`
- `knownAbilities` → `knownTalents` / `knownTalentIds`
- `abilities` 运行时列表 → `knownTalentIds`
- cooldown / duration 使用 action count，而不是 tick
- sustain 不是“开战前统一补装”

### 仍可继续演化的部分

- 玩家优先级 UI 的交互形态
- 新职业 talent 的具体数值与前置树
- 是否把 `behavior/ability/` 真正迁目录名

---

## 11. 后续建议

为了减少文档再次漂移，建议把技能系统文档拆成两层：

- **实现契约**：放 `docs/modules/effect-ability.md`
- **设计目标**：保留在本文，只写已经确认的大方向，不再堆叠过细、未实现的 24 技能细表
