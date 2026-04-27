# stage / activity

这一组模块分别负责运行实例中的 actor 生命周期，以及玩家当前正在执行的活动。

## 三层概念模型

```text
LocationDef        — “我在哪”（物理地点 / 地图区域）
  └─ LocationEntryDef — “这里能做什么”（战斗入口 / 采集入口 / 副本入口）
       └─ StageSession  — “当前运行的实例”（只包含正在交互的 actor）
```

- **LocationDef** 是纯静态内容；注册在 `ContentDb.locations` 中
- **LocationEntryDef** 挂在 Location 下面，是一个联合类型（`combat` / `gather` / `dungeon`）
- **StageSession** 是运行态纯数据，存放在 `state.stages[stageId]` 中；通过 `mode: StageMode` 联合体区分 `combatZone` / `gather` / `dungeon`
- `PlayerCharacter.locationId` 记录角色当前在哪个地点；切换地点不会自动创建实例
- `PlayerCharacter.stageId` 引用 `state.stages` 中的条目；多角色共享同一 stage 时都指向同一个 `stageId`

## Stage（运行实例）

- `StageController` 是一个 `Tickable`
- 它负责管理当前实例中的 actor，包括生成、重生和离开时的清理
- 每个 `StageSession` 记录：
  - `locationId`
  - `mode`
  - `spawnedActorIds`
  - 当前波次 `currentWave`
  - 进行中的 `pendingCombatWaveSearch`
  - `pendingLoot`（背包满时溢出的物品）
- `StageMode` 是联合类型：
  - `{ kind: "combatZone"; combatZoneId }`
  - `{ kind: "gather" }`
  - `{ kind: "dungeon"; dungeonSessionId }`
- Stage 只负责 actor 生命周期，不负责战斗推进
- 运行时实例 ID 统一由 `GameState.runtimeIds.nextSeq` 分配

### CombatZone / Wave

- `CombatZoneDef` 是 ContentDb 的顶层注册表，通过 `getCombatZone(id)` 查找
- 每个 combat zone 包含若干候选 `waves`
- 每次刷怪时，会按 `waveSelection` 选择一个 wave；当前只支持 `random`
- `currentWave.status` 表示这一波当前还在战斗中，还是已经以胜利 / 失败结算并等待清理
- `pendingCombatWaveSearch` 表示玩家已经进入“搜索敌人”流程，StageController 会在 `waveSearchTicks` 到达后生成下一波
- 难度差异体现在入口层：同一个 Location 可以有“普通”和“困难”两个战斗入口，指向不同的 `CombatZoneDef`

## CharacterController 命令流程

1. `cc.enterLocation(locationId)` —— 设置 `hero.locationId`，不创建实例
2. `cc.startFight(combatZoneId)` —— 创建 `StageSession`，写入 `state.stages`，设 `hero.stageId`，并创建 `CombatActivity`
3. `cc.startGather(nodeId)` —— 创建 `StageSession`，设 `hero.stageId`，刷资源节点，创建 `GatherActivity`
4. `cc.stopActivity()` —— 停止活动，清理 stage
5. `cc.leaveLocation()` —— 清理实例，清空 `hero.locationId`

多人组队战斗由 `session.startPartyCombat(combatZoneId, partyCharIds)` 直接调用。副本则由 session 统一创建 `DungeonWorldActivity`。

## Activity

Activity 表示玩家当前在实例中做的事。它本身也是 `Tickable`。

### CombatActivity（WorldActivity）

`CombatActivity` 是以 `stageId` 为键的 **WorldActivity**，不再绑定单个角色。

- `partyCharIds`：参与战斗的角色列表；单人战斗为 `[heroId]`
- 状态机：`searchingEnemies → fighting → deathRecovering → stopped`
- 只从 `state.stages[activity.stageId]` 中读取仍然存活的 enemy，并据此创建 `Battle`
- 每次 phase 切换后，`syncCombatToHeroes()` 会把状态镜像到所有队员的 `hero.activity`
- `hero.activity` 遵循单一写入者约束：只有 activity 自己会写这个字段
- 首次启动时，`onStart` 会重置战斗前所有队员的 HP / MP，并清空有限时长的 effects 与 cooldowns；永久 effect（`remainingActions === -1`）会保留
- 从存档恢复时走继续执行路径，跳过这些只应在 fresh start 发生的副作用

#### 各 phase 语义

- `searchingEnemies`
  - 固定的搜敌 / 波间休整窗口
  - 若当前 stage 还没有 `currentWave` 且没有 `pendingCombatWaveSearch`，会调用 `beginCombatWaveSearch()`
  - 在这一阶段，所有队员会通过 `phase_recovery` effect 获得临时的波间回复加成，每个 logic tick 读取 `HP_REGEN / MP_REGEN` 属性恢复 HP / MP（注意：这是活动层的 tick 回复，与战斗内按 scheduler 时间基缩放的自然回复是两条独立通道）
  - 一旦 stage 里出现存活敌人，就立刻开战
- `fighting`
  - 当前存在一个 `Battle`
  - 交给 `tickBattle()` 推进
  - 战斗结束后：
    - 若我方仍有人存活且无人阵亡，回到 `searchingEnemies`
    - 若任意队员死亡，进入 `deathRecovering`
- `deathRecovering`
  - 明确的死亡惩罚阶段，不再是旧文档里的“低血量 recovering”
  - 活着的队员会持续回复；死者等待复活计时结束
  - 计时结束后，全队恢复到满血满蓝，再回到 `searchingEnemies`
- `stopped`
  - 终止态

#### 奖励语义

- **击杀奖励**（XP、货币）按存活队员人数平均分摊，每人拿到整除后的份额
- **波次奖励**：
  - 物品一次随机发给某个存活队员
  - 货币在存活队员间平均分摊
- 波次奖励只在 `players_won` 时发放；如果全灭，该波失败且不发波次奖励
- 战斗结束时会发出 `waveResolved` 事件

### GatherActivity

- 绑定一个 `nodeId`
- 每经过 `swingTicks` 发放一轮奖励
- 每次 swing 后，也会把状态同步回 `hero.activity`

### DungeonWorldActivity

- WorldActivity，不绑定单个角色，驱动整个副本运行
- 状态机：`spawningWave → fighting → waveCleared → recovering → completed / failed / abandoned`
- 详见 [dungeon.md](./dungeon.md)

## 持久化

- Activity 的持久化形态是 `PlayerCharacter.activity`
- CombatActivity 的持久化数据包含：
  - `stageId`
  - `partyCharIds`
  - `phase`
  - `currentBattleId`
  - `lastTransitionTick`
- 读档时由 session 根据这份数据重新实例化运行时 `Tickable`；同一 `stageId` 的多个队员只创建一个 CombatActivity 实例
- store 不直接改写 `hero.activity`，避免 activity 运行时状态与存档状态漂移
- `StageSession` 以 JSON-safe 纯数据保存，因此 combat zone / wave 进度与 `pendingLoot` 可以随存档一起恢复

## 边界

- stage 不读取战斗内部调度状态
- activity 不负责 actor 生命周期
- activity 的注册、注销和切换由 `session` 统一编排

## 入口

- `src/core/world/stage/`
- `src/core/world/activity/`
- `src/core/content/types.ts`（`LocationDef`, `CombatZoneDef`, `DungeonDef`）
- `src/core/infra/state/types.ts`（`DungeonSession`）
