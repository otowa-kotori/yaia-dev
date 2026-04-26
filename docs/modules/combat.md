# combat / intent

这一组模块负责战斗状态、自动决策、ATB 行动调度和胜负推进。它消费 `effect` / `talent` 这套通用行为系统，但自身属于独立的战斗编排层。

## 定位

- `Battle` 表示一场战斗的纯数据状态
- `SchedulerState` 表示行动调度需要的状态；当前唯一实现是 ATB scheduler
- `Intent` 表示战斗中的自动决策：给定当前局面，这个 actor 这次行动窗口要做什么
- `tickBattle` 负责推进战斗，直到本 tick 内所有就绪 actor 都结算完，或已经分出胜负

## Battle

- `Battle` 是可序列化的纯数据对象，存放在 `state.battles[]` 中
- `Battle` 只保存 `participantIds`，真正的 actor 仍然活在 `GameState.actors`
- `Battle.metadata` 保存最小作用域信息，供 battle 摘要事件镜像到统一玩家日志
- `Battle.intents` 是 `Record<actorId, intentId>`，不直接存函数
- `Battle.deathsReported` 用于确保 `battleActorDied` / `kill` 只发一次

## 调度：ATB Scheduler

当前实现已经不是旧的“速度排序回合制”，而是 FF 风格的 ATB：

- `actionThreshold = 1000`
- `baseEnergyGain = 40`
- `baseSpeed = 40`
- `initialEnergy = min(actionThreshold - 1, SPD × 12)`
- 每个 logic tick 执行：
  - 给所有存活参与者按 `40 × (SPD / 40)` 充能
  - 之后反复取出所有 `energy >= 1000` 的 actor
  - 同 tick 多人就绪时，按 `energy` 降序结算；若同值，按 `participantIds` 顺序稳定打破平局
- 行动结算后，`scheduler.onActionResolved` 会扣除能量；默认扣 `1000`，也可以由 talent 的 `energyCost` 覆盖
- 高能量消耗技能会把 actor 的 energy 扣成负数；UI 用 `energyFloorByActorId` 修正进度条显示

## 行动窗口

每个 actor 的一次行动窗口按下面顺序运行：

1. `processActionEffects(actor)` —— effect 按“拥有者自己的行动次数”推进
2. 如果 actor 因自己的 DoT 或其他前置 effect 死亡，则这次窗口仍然被消耗
3. 解析 `battle.intents[actor.id]`
4. intent 返回 `talentId + targets`
5. 读取 `TalentDef.getActiveParams()`，得到 `energyCost`
6. 调用 `tryUseTalent()` 执行
7. 行动结束后，actor 身上的所有正 cooldown `-1`

## Intent

`Intent` 只用于战斗语境。

- `intents: Record<actorId, intentId>` 为每个参战者记录一个 `intentId`
- 执行时通过 `resolveIntent(id)` 从注册表中取出对应函数
- `Intent` 的返回值是本次行动的计划，例如使用哪个 `talent`、目标是谁
- 内建 intent 仍然包含 `INTENT.RANDOM_ATTACK`，但当前正式战斗入口默认使用 `INTENT.PRIORITY_LIST`

之所以把 intent 设计成字符串 ID + 注册表，而不是把函数直接挂在 `Battle` 上，是因为 `Battle` 必须保持为可序列化的纯数据。

## PRIORITY_LIST 的当前语义

### 玩家

- 新战斗创建时，`buildBattleIntents(participants)` 会给所有参战者分配 `INTENT.PRIORITY_LIST`
- 玩家侧不会从 UI 拖拽配置单独存一份优先级表
- 当前实现是：读取 `equippedTalents`，按 `TalentDef.intentPriority` 升序构造规则
- 只有 `type === "active"` 且声明了 `intentPriority` 的 talent 会进入优先级列表

### 敌人

- 优先读取 `MonsterDef.intentConfig`
- 如果 monster 没写 `intentConfig`，则从 `MonsterDef.talents` 自动构造优先级列表

### RANDOM_ATTACK 的角色

`INTENT.RANDOM_ATTACK` 仍保留为内建 fallback / 测试用途：

- 随机选择一个敌方目标（按 `AGGRO_WEIGHT` 加权）
- 使用 `knownTalentIds[0]` 作为默认攻击

## 胜负与奖励

- 胜负由 `tickBattle` 判断
- `combat` 自己不直接发放奖励，只负责发出战斗相关事件
- `Battle` 会镜像发出：`battleActionStarted`、`battleActionResolved`、`battleActorDied`、`battleEnded`
- `kill` 事件由监听者（如 `CombatActivity`）接收，再发放逐个怪物的击杀奖励
- 波次奖励不属于 `Battle` 本身；它由 `CombatActivity` 在 `players_won` 后统一结算

## 边界

- `combat` 不定义通用效果结算规则；伤害、治疗、buff、反应钩子都交给 `effect` / `talent`
- `intent` 不负责真正执行动作；它只负责在战斗语境中产出行动计划
- `combat` 负责推进战斗、调度行动和发出事件，不负责把奖励直接写入具体业务状态

## 入口

- `src/core/combat/`
- `src/core/combat/intent/`
