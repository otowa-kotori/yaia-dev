# combat / intent

这一组模块负责战斗状态、自动决策、行动顺序和胜负推进。它消费 `effect` / `ability` 这套通用行为系统，但自身属于独立的战斗编排层。

## 定位

- `Battle` 表示一场战斗的纯数据状态
- `SchedulerState` 表示行动调度需要的状态
- `Intent` 表示战斗中的自动决策：给定当前战斗局面，这个 actor 这一回合要做什么
- `tickBattle` 负责推进战斗，直到产生下一次行动或分出胜负

## Intent

`Intent` 只用于战斗语境。

- `intents: Record<actorId, intentId>` 为每个参战者记录一个 `intentId`
- 执行时通过 `resolveIntent(id)` 从注册表中取出对应函数
- `Intent` 的返回值是本回合的行动计划，例如使用哪个 `ability`、目标是谁
- 当前内建的默认实现是 `INTENT.RANDOM_ATTACK`
- 数据驱动的 intent 接口已经预留；当前 MVP 仍以代码注册为主

之所以把 intent 设计成字符串 ID + 注册表，而不是把函数直接挂在 `Battle` 上，是因为 `Battle` 需要保持为可序列化的纯数据，能够写入 `GameState` 和存档。

## 核心结构

- `Battle` 是可序列化的纯数据对象，存放在 `state.battles[]` 中
- `SchedulerState` 也是纯数据；`nextActor()` 是独立自由函数
- `SpeedSortedScheduler` 每次选择行动者时都会按 speed 重排，因此速度类 buff 会立即生效
- 行动节奏通过 `actionDelayTicks` 推进，headless 模式与实时模式保持一致
- 每次轮到 actor 行动时，战斗流程会先解析其 `Intent`，再通过 `tryUseAbility` 执行对应动作

## 胜负与奖励

- 胜负由 `tickBattle` 判断
- `combat` 自己不直接发放奖励，只负责发出战斗相关事件
- `kill` 事件会被 listener（如 `CombatActivity`）接收，再通过 `applyEffect(synthesizedInstantEffect)` 发放逐个怪物的击杀奖励
- 波次奖励不属于 `Battle` 本身；它由 `CombatActivity` 在战斗结束且结果为 `players_won` 时，根据当前 encounter 的 wave reward 配置统一结算
- `waveResolved` 事件描述的是波次层面的结算，不是 `Battle` 内部调度的一部分

## 边界

- `combat` 不定义通用行为结算规则；伤害、治疗、buff、奖励等都交给 `effect` / `ability`
- `intent` 不负责真正执行动作；它只负责在战斗语境中产出行动计划
- `combat` 负责推进战斗、调度行动和发出事件，不负责把奖励写入具体状态

## 入口

- `src/core/combat/`
- `src/core/intent/`
