# effect / ability

这一组模块负责通用的行为表达与效果结算，不依赖战斗系统存在。

> 说明：目录名仍然叫 `behavior/ability/`，但当前语义已经不是旧的 `AbilityDef`，而是 `TalentDef` 驱动的施放管线（`tryUseTalent`）。

## 定位

- `TalentDef` 表示角色可学习/可施放的行为定义
- `EffectDef` 表示 talent、掉落、升级奖励等命中后产生的具体结算模板
- `EffectInstance` 表示施加到角色身上的运行时 effect 实例

三者组合起来，构成一条可复用的行为管线。战斗技能、波间恢复、击杀奖励、采集奖励都可以走这套机制。

## Talent 施放管线

当前入口是 `tryUseTalent(caster, talentId, targets, ctx)`。

### 校验顺序

1. 施法者是否存活
2. `knownTalentIds` 中是否已知该 talent
3. 如果是玩家且 `tpCost > 0`，是否已装备到 `equippedTalents`
4. talent 是否存在，且是否是 active talent
5. cooldown 是否为 0
6. MP 是否足够
7. 目标是否合法

校验通过后：

- 扣 MP
- 设置 cooldown（单位是 **owner action count**）
- 调用 `TalentDef.execute(...)`
- 若 talent 没写 `execute`，则 fallback 到声明式 `effects[]`

## Effect

`EffectDef.kind` 当前有三种：

- **instant**：立即结算，可带 `formula` 和 `rewards`
- **duration**：安装 modifiers，并登记 `EffectInstance`
- **periodic**：以 `duration` 为基础，每隔 `periodActions` 触发一次结算

### infinite 的表达方式

当前没有单独的 `EffectKind = "infinite"`。

- “永久” effect 由运行时 `EffectInstance.remainingActions = -1` 表示
- 被动 talent、sustain 姿态、某些长期世界效果都走这一条路径

### 生命周期钩子

`EffectDef` 可携带：

- `onApply`
- `onTick`
- `onRemove`
- `reactions`

其中 `reactions` 是战斗中的同步可变钩子；它们跟随 effect 实例的生灭自动生效/失效。

## 时间单位

这里的时序语义已经统一到“拥有者行动次数”：

- `cooldownActions`
- `durationActions`
- `periodActions`
- `EffectInstance.remainingActions`

它们不是 wall clock，也不是 engine tick。ATB 只影响“多久轮到你行动一次”，不直接改写这些计数的语义。

## 伤害与治疗

当前 runtime 通过 `FormulaRef.kind` 区分：

- `phys_damage_v1`
- `magic_damage_v1`

`tryUseTalent` 在战斗中会把 damage 结算嵌入 reaction 管线：

1. 先算 raw damage
2. 触发 `before_damage_taken`
3. 扣 HP
4. 触发 `after_damage_taken`
5. 触发 `after_damage_dealt`
6. 如果目标死亡，再触发 `on_kill`

> 当前运行时物理公式仍使用旧的 `phys_damage_v1`；更上层的目标数值方向见 `docs/design/combat-formula.md`。

## 结果事件

effect 结算会补发结构化结果事件，例如：

- `damage`
- `heal`
- `loot`
- `currencyChanged`
- `pendingLootOverflowed`

这些事件供统一玩家日志与 UI 复用。

## 与 talent 系统的分工

- `TalentDef` 负责“什么时候施放、对谁施放、需要多少资源”
- `EffectDef` 负责“命中后具体发生什么”
- passive / sustain talent 通过 `grantEffects()` 安装 `remainingActions = -1` 的长期 effect
- sustain 的开启/关闭发生在学习、切换或装备逻辑里，不是在 `createBattle()` 之后统一补装

## 边界

- 这一层不依赖 `combat`，因此也能用于采集、升级奖励、波次奖励等非战斗场景
- 它负责表达行为、效果和同步 reaction；但不负责推进战斗调度、选择行动或判定战斗胜负
- 货币变动的业务来源（击杀奖励、波次奖励、副本奖励）由外层调用方通过上下文传入，effect 不自行猜测

## 入口

- `src/core/behavior/effect/`
- `src/core/behavior/ability/`
