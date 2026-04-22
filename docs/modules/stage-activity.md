# stage / activity

这一组模块分别负责运行实例中的 actor 生命周期，以及玩家当前正在执行的活动。

## 三层概念模型

```
LocationDef        — "我在哪"（物理地点 / 地图区域）
  └─ LocationEntryDef — "这里能做什么"（战斗入口 / 采集入口）
       └─ StageSession  — "当前运行的实例"（只包含正在交互的 actor）
```

- **LocationDef** 是纯静态内容；注册在 `ContentDb.locations` 中
- **LocationEntryDef** 挂在 Location 下面，是一个联合类型（`combat` / `gather` / `dungeon`）
- **StageSession** 是运行态纯数据，存放在 `state.stages[stageId]` 中；通过 `mode: StageMode` 联合体区分 combatZone / gather / dungeon
- `PlayerCharacter.locationId` 记录角色当前在哪个地点；切换地点不会自动创建实例
- `PlayerCharacter.stageId` 引用 `state.stages` 中的条目；多角色可独立各自拥有 stage

## Stage（运行实例）

- `StageController` 是一个 `Tickable`
- 它负责管理当前实例中的 actor，包括生成、重生和离开时的清理
- 每个 `StageSession` 记录 `locationId`、`mode`（StageMode 联合体）、`spawnedActorIds`、当前波次 `currentWave`、进行中的 `pendingCombatWaveSearch`，以及 `pendingLoot`（背包满时溢出的物品）
- `StageMode` 是联合类型：`{ kind: "combatZone"; combatZoneId }` / `{ kind: "gather" }` / `{ kind: "dungeon"; dungeonSessionId }`
- 每个角色同一时刻只能在一个运行实例中，但多个角色可以各自拥有独立的 stage
- Stage 只负责 actor 生命周期，不负责战斗推进

### CombatZone / Wave

- `CombatZoneDef` 是 ContentDb 的顶层注册表，通过 `getCombatZone(id)` 查找
- 每个 combat zone 包含若干候选 `waves`
- 每次刷怪时，会按 `waveSelection` 选择一个 wave；当前只支持 `random`
- `currentWave.status` 表示这一波当前还在战斗中，还是已经以胜利 / 失败结算并等待清理
- `pendingCombatWaveSearch` 表示玩家已经进入“搜索敌人”流程，StageController 会在 `waveSearchTicks` 到达后生成下一波
- 难度差异体现在入口层：同一个 Location 可以有"普通"和"困难"两个战斗入口，指向不同的 CombatZoneDef

## CharacterController 命令流程

1. `cc.enterLocation(locationId)` — 设置 `hero.locationId`，不创建实例
2. `cc.startFight(combatZoneId)` — 创建 StageSession 写入 `state.stages`，设 `hero.stageId`，刷首波，创建 CombatActivity
3. `cc.startGather(nodeId)` — 创建 StageSession 写入 `state.stages`，设 `hero.stageId`，刷资源节点，创建 GatherActivity
4. `cc.stopActivity()` — 停止活动，清理 stage
5. `cc.leaveLocation()` — 清理实例，清空 `hero.locationId`

## Activity

Activity 表示玩家当前在实例中做的事。它本身也是 `Tickable`。

### CombatActivity

- 使用 `searchingEnemies → fighting → recovering → stopped` 状态机
- 只从 `state.stages[hero.stageId]` 中读取仍然存活的 enemy，并据此创建 `Battle`
- 每次 phase 切换后，activity 都会把当前状态同步回 `hero.activity`
- `hero.activity` 遵循单一写入者约束：只有 activity 自己会写这个字段
- 首次启动时，`onStart` 会重置战斗前的 HP / MP，并清空 effects 与 cooldowns
- 从存档恢复时走继续执行路径，跳过这些只应在首次启动时发生的副作用
- 怪物击杀奖励仍然通过 `kill` 事件发放
- 波次奖励只在 `players_won` 时发放；如果玩家团灭，则该波失败且拿不到波次奖励
- 战斗结束后，如果角色 HP 比例低于 combat zone 配置的阈值 `recoverBelowHpFactor`，会先进入 `recovering` 把血回满，再继续等待下一波
- 战斗结束时会发出 `waveResolved` 事件，供 UI 或其他系统订阅

### GatherActivity

- 绑定一个 `nodeId`
- 每经过 `swingTicks` 发放一轮奖励
- 每次 swing 后，也会把状态同步回 `hero.activity`

### DungeonWorldActivity

- WorldActivity，不绑定单个角色，驱动整个副本运行
- 状态机：`spawningWave → fighting → waveCleared → recovering → completed / failed / abandoned`
- 详见 [dungeon.md](./dungeon.md)

## 持久化

- Activity 的持久化形态是 `PlayerCharacter.activity`，其中保存 `kind` 与对应数据
- 读档时由 session 根据这份数据重新实例化运行时 `Tickable`
- store 不直接改写 `hero.activity`，避免 activity 运行时状态与存档状态漂移
- Stage session 以 JSON-safe 纯数据保存，因此 combat zone / wave 进度与 pendingLoot 可以随存档一起恢复

## 边界

- stage 不读取战斗内部调度状态
- activity 不负责 actor 生命周期
- activity 的注册、注销和切换由 `session` 统一编排

## 入口

- `src/core/stage/`
- `src/core/activity/`
- `src/core/content/types.ts`（LocationDef, CombatZoneDef, DungeonDef）
- `src/core/state/types.ts`（DungeonSession）
