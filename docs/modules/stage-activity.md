# stage / activity

这一组模块分别负责场景中的 actor 生命周期，以及玩家当前正在执行的活动。

## Stage

- `StageController` 是一个 `Tickable`
- 它负责管理当前场景中的 actor，包括生成、重生和离开场景时的清理
- `state.currentStage` 记录当前 session 所在的 stage 信息，例如 `stageId`、`spawnedActorIds`、当前 encounter，以及当前波次 `currentWave`
- 同一时刻只能处于一个 stage 中
- Stage 只负责 actor 生命周期，不负责战斗推进

### encounter / wave

- 一个 `StageDef` 可以包含若干 `encounters`
- 当前 MVP 只会激活一个 encounter；默认使用 `encounters[0]`
- 每个 encounter 包含若干候选 `waves`
- 每次刷怪时，会按 `waveSelection` 选择一个 wave；当前只支持 `random`
- `currentWave.status` 表示这一波当前还在战斗中，还是已经以胜利 / 失败结算并进入冷却
- 波次结算后，StageController 会清掉这一波的敌人，然后等待 `waveIntervalTicks` 再刷下一波

## Activity

Activity 表示玩家当前在 stage 中做的事。它本身也是 `Tickable`。

### CombatActivity

- 使用 `waitingForEnemies → fighting → recovering → stopped` 状态机
- 只从 `state.currentStage` 中读取仍然存活的 enemy，并据此创建 `Battle`
- 每次 phase 切换后，activity 都会把当前状态同步回 `hero.activity`
- `hero.activity` 遵循单一写入者约束：只有 activity 自己会写这个字段
- 首次启动时，`onStart` 会重置战斗前的 HP / MP，并清空 effects 与 cooldowns
- 从存档恢复时走继续执行路径，跳过这些只应在首次启动时发生的副作用
- 怪物击杀奖励仍然通过 `kill` 事件发放
- 波次奖励只在 `players_won` 时发放；如果玩家团灭，则该波失败且拿不到波次奖励
- 战斗结束后，如果角色 HP 比例低于 stage 配置的阈值 `recoverBelowHpFactor`，会先进入 `recovering` 把血回满，再继续等待下一波
- 战斗结束时会发出 `waveResolved` 事件，供 UI 或其他系统订阅

### GatherActivity

- 绑定一个 `nodeId`
- 每经过 `swingTicks` 发放一轮奖励
- 每次 swing 后，也会把状态同步回 `hero.activity`

## 持久化

- Activity 的持久化形态是 `PlayerCharacter.activity`，其中保存 `kind` 与对应数据
- 读档时由 session 根据这份数据重新实例化运行时 `Tickable`
- store 不直接改写 `hero.activity`，避免 activity 运行时状态与存档状态漂移
- Stage session 以 JSON-safe 纯数据保存，因此 encounter / wave 进度可以随存档一起恢复

## 边界

- stage 不读取战斗内部调度状态
- activity 不负责 actor 生命周期
- activity 的注册、注销和切换由 `session` 统一编排

## 入口

- `src/core/stage/`
- `src/core/activity/`
